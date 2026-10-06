import "../utils/pdfPolyfill.js";
import fs from "fs"
import path from "path";
import { createRequire } from "module";
import * as pdfjsLib from "pdfjs-dist/legacy/build/pdf.mjs";
import { askAi } from "../services/openRouter.service.js";
import { parseAiJson } from "../utils/safeJson.js";
import { textToSpeech } from "../services/sarvam.service.js";
import User from "../models/user.model.js";
import Interview from "../models/interview.model.js";

// pdfjs needs the packaged standard fonts on disk, otherwise every resume that
// uses a non-embedded font logs warnings and can drop glyphs.
const require = createRequire(import.meta.url);
const STANDARD_FONT_DATA_URL = path.join(
  path.dirname(require.resolve("pdfjs-dist/package.json")),
  "standard_fonts/"
);

// Groq has a token ceiling per request; a long resume would otherwise blow it.
const MAX_RESUME_CHARS = 12000;

const toStringField = (value) => {
  if (typeof value === "string") return value.trim();
  if (Array.isArray(value)) return value.filter(Boolean).join(", ");
  if (value == null) return "";
  return String(value);
};

const toStringArray = (value) => {
  if (!Array.isArray(value)) return value ? [toStringField(value)].filter(Boolean) : [];
  return value
    .map((item) => {
      if (typeof item === "string") return item.trim();
      // The model sometimes returns objects like { name, description }
      if (item && typeof item === "object") {
        return toStringField(item.name || item.title || item.project || item.skill);
      }
      return "";
    })
    .filter(Boolean);
};

export const analyzeResume = async (req, res) => {
  if (!req.file) {
    return res.status(400).json({ message: "Resume required" });
  }

  const filepath = req.file.path;

  try {
    const fileBuffer = await fs.promises.readFile(filepath)
    const uint8Array = new Uint8Array(fileBuffer)

    let pdf;
    try {
      pdf = await pdfjsLib.getDocument({
        data: uint8Array,
        standardFontDataUrl: STANDARD_FONT_DATA_URL,
        // No DOM in Node, and eval is unnecessary for text extraction.
        disableFontFace: true,
        isEvalSupported: false,
        useSystemFonts: false,
      }).promise;
    } catch (pdfError) {
      console.error("PDF parse error:", pdfError.message);
      return res.status(400).json({
        message: "Could not read that PDF. It may be corrupted or password protected.",
      });
    }

    let resumeText = "";

    // Extract text from all pages
    for (let pageNum = 1; pageNum <= pdf.numPages; pageNum++) {
      const page = await pdf.getPage(pageNum);
      const content = await page.getTextContent();

      const pageText = content.items.map(item => item.str).join(" ");
      resumeText += pageText + "\n";
    }

    resumeText = resumeText
      .replace(/\s+/g, " ")
      .trim();

    // Scanned/image-only resumes extract to nothing - there is no point calling the AI.
    if (resumeText.length < 50) {
      return res.status(400).json({
        message: "No readable text found in this PDF. If it is a scan, please fill the fields manually.",
      });
    }

    const truncatedResume = resumeText.slice(0, MAX_RESUME_CHARS);

    const messages = [
      {
        role: "system",
        content: `
Extract structured data from resume.

Return strictly JSON:

{
  "role": "string",
  "experience": "string",
  "projects": ["project1", "project2"],
  "skills": ["skill1", "skill2"]
}

Rules:
- "role" and "experience" must be plain strings, never arrays or objects.
- "projects" and "skills" must be arrays of plain strings.
- If something is not present in the resume, use "" for strings and [] for arrays.
`
      },
      {
        role: "user",
        content: truncatedResume
      }
    ];

    const aiResponse = await askAi(messages, { json: true })
    const parsed = parseAiJson(aiResponse);

    res.json({
      role: toStringField(parsed.role),
      experience: toStringField(parsed.experience),
      projects: toStringArray(parsed.projects),
      skills: toStringArray(parsed.skills),
      resumeText
    });

  } catch (error) {
    console.error("analyzeResume failed:", error);
    return res.status(500).json({ message: error.message || "Failed to analyze resume." });
  } finally {
    // Always clean up the upload, on success and failure alike.
    await fs.promises.unlink(filepath).catch(() => {});
  }
};


export const generateQuestion = async (req, res) => {
  try {
    let { role, experience, mode, resumeText, projects, skills } = req.body

    role = role?.trim();
    experience = experience?.trim();
    mode = mode?.trim();

    if (!role || !experience || !mode) {
      return res.status(400).json({ message: "Role, Experience and Mode are required." })
    }

    const user = await User.findById(req.userId)

    if (!user) {
      return res.status(404).json({
        message: "User not found."
      });
    }

    if (user.credits < 50) {
      return res.status(400).json({
        message: "Not enough credits. Minimum 50 required."
      });
    }

    const projectText = Array.isArray(projects) && projects.length
      ? projects.join(", ")
      : "None";

    const skillsText = Array.isArray(skills) && skills.length
      ? skills.join(", ")
      : "None";

    const safeResume = resumeText?.trim()
      ? resumeText.trim().slice(0, MAX_RESUME_CHARS)
      : "None";

    const userPrompt = `
    Role:${role}
    Experience:${experience}
    InterviewMode:${mode}
    Projects:${projectText}
    Skills:${skillsText},
    Resume:${safeResume}
    `;

    if (!userPrompt.trim()) {
      return res.status(400).json({
        message: "Prompt content is empty."
      });
    }

    const messages = [

      {
        role: "system",
        content: `
You are a real human interviewer conducting a professional interview.

Speak in simple, natural English as if you are directly talking to the candidate.

Generate exactly 5 interview questions.

Strict Rules:
- Each question must contain between 15 and 25 words.
- Each question must be a single complete sentence.
- Do NOT number them.
- Do NOT add explanations.
- Do NOT add extra text before or after.
- One question per line only.
- Keep language simple and conversational.
- Questions must feel practical and realistic.

Difficulty progression:
Question 1 → easy  
Question 2 → easy  
Question 3 → medium  
Question 4 → medium  
Question 5 → hard  

Make questions based on the candidate’s role, experience,interviewMode, projects, skills, and resume details.
`
      }
      ,
      {
        role: "user",
        content: userPrompt
      }
    ];


    const aiResponse = await askAi(messages)

    if (!aiResponse || !aiResponse.trim()) {
           
      return res.status(500).json({
        message: "AI returned empty response."
      });

    }

    const cleanedLines = aiResponse
      .split("\n")
      .map(q => q.trim())
      // The model sometimes numbers or bullets the lines despite being told not to.
      .map(q => q.replace(/^(?:[-*\u2022]|\d+[.)])\s*/, "").trim())
      .filter(q => q.length > 0);

    // Drop chatty wrappers like "Here are the questions:" so they cannot take the
    // place of a real question. Matching on a trailing colon rather than on a
    // trailing "?" keeps valid imperative prompts ("Tell me about a time...").
    const questionLines = cleanedLines.filter(q => !q.endsWith(":") && q.length > 15);

    const questionsArray = (questionLines.length ? questionLines : cleanedLines).slice(0, 5);

    if (questionsArray.length === 0) {
      
      return res.status(500).json({
        message: "AI failed to generate questions."
      });
    }

    user.credits -= 50;
    await user.save();

    const interview = await Interview.create({
      userId: user._id,
      role,
      experience,
      mode,
      resumeText: safeResume,
      questions: questionsArray.map((q, index) => ({
        question: q,
        difficulty: ["easy", "easy", "medium", "medium", "hard"][index],
        timeLimit: [60, 60, 90, 90, 120][index],
      }))
    })

    res.json({
      interviewId: interview._id,
      creditsLeft: user.credits,
      userName: user.name,
      questions: interview.questions
    });
  } catch (error) {
    console.error("generateQuestion failed:", error);
    return res.status(500).json({ message: error.message || "Failed to create interview." })
  }
}


export const submitAnswer = async (req, res) => {
  try {
    const { interviewId, questionIndex, answer, timeTaken } = req.body

    const interview = await Interview.findById(interviewId)

    if (!interview) {
      return res.status(404).json({ message: "Interview not found." });
    }

    const question = interview.questions[questionIndex]

    if (!question) {
      return res.status(400).json({ message: "Invalid question index." });
    }

    // If no answer
    if (!answer) {
      question.score = 0;
      question.feedback = "You did not submit an answer.";
      question.answer = "";

      await interview.save();

      return res.json({
        feedback: question.feedback
      });
    }

    // If time exceeded
    if (timeTaken > question.timeLimit) {
      question.score = 0;
      question.feedback = "Time limit exceeded. Answer not evaluated.";
      question.answer = answer;

      await interview.save();

      return res.json({
        feedback: question.feedback
      });
    }


    const messages = [
      {
        role: "system",
        content: `
You are a professional human interviewer evaluating a candidate's answer in a real interview.

Evaluate naturally and fairly, like a real person would.

Score the answer in these areas (0 to 10):

1. Confidence – Does the answer sound clear, confident, and well-presented?
2. Communication – Is the language simple, clear, and easy to understand?
3. Correctness – Is the answer accurate, relevant, and complete?

Rules:
- Be realistic and unbiased.
- Do not give random high scores.
- If the answer is weak, score low.
- If the answer is strong and detailed, score high.
- Consider clarity, structure, and relevance.

Calculate:
finalScore = average of confidence, communication, and correctness (rounded to nearest whole number).

Feedback Rules:
- Write natural human feedback.
- 10 to 15 words only.
- Sound like real interview feedback.
- Can suggest improvement if needed.
- Do NOT repeat the question.
- Do NOT explain scoring.
- Keep tone professional and honest.

Return ONLY valid JSON in this format:

{
  "confidence": number,
  "communication": number,
  "correctness": number,
  "finalScore": number,
  "feedback": "short human feedback"
}
`
      }
      ,
      {
        role: "user",
        content: `
Question: ${question.question}
Answer: ${answer}
`
      }
    ];


    const aiResponse = await askAi(messages, { json: true })

    const parsed = parseAiJson(aiResponse);

    question.answer = answer;
    question.confidence = parsed.confidence;
    question.communication = parsed.communication;
    question.correctness = parsed.correctness;
    question.score = parsed.finalScore;
    question.feedback = parsed.feedback;
    await interview.save();


    return res.status(200).json({feedback :parsed.feedback})
  } catch (error) {
    console.error("submitAnswer failed:", error);
    return res.status(500).json({ message: error.message || "Failed to submit answer." })

  }
}


export const finishInterview = async (req,res) => {
  try {
    const {interviewId} = req.body
    const interview = await Interview.findById(interviewId)
    if(!interview){
      return res.status(400).json({message:"failed to find Interview"})
    }

    const totalQuestions = interview.questions.length;

    let totalScore = 0;
    let totalConfidence = 0;
    let totalCommunication = 0;
    let totalCorrectness = 0;

    interview.questions.forEach((q) => {
      totalScore += q.score || 0;
      totalConfidence += q.confidence || 0;
      totalCommunication += q.communication || 0;
      totalCorrectness += q.correctness || 0;
    });

    const finalScore = totalQuestions
      ? totalScore / totalQuestions
      : 0;

    const avgConfidence = totalQuestions
      ? totalConfidence / totalQuestions
      : 0;

    const avgCommunication = totalQuestions
      ? totalCommunication / totalQuestions
      : 0;

    const avgCorrectness = totalQuestions
      ? totalCorrectness / totalQuestions
      : 0;

    interview.finalScore = finalScore;
    interview.status = "completed";

    await interview.save();

    return res.status(200).json({
       finalScore: Number(finalScore.toFixed(1)),
      confidence: Number(avgConfidence.toFixed(1)),
      communication: Number(avgCommunication.toFixed(1)),
      correctness: Number(avgCorrectness.toFixed(1)),
      questionWiseScore: interview.questions.map((q) => ({
        question: q.question,
        score: q.score || 0,
        feedback: q.feedback || "",
        confidence: q.confidence || 0,
        communication: q.communication || 0,
        correctness: q.correctness || 0,
      })),
    })
  } catch (error) {
    return res.status(500).json({message:`failed to finish Interview ${error}`})
  }
}


export const getMyInterviews = async (req,res) => {
  try {
    const interviews = await Interview.find({userId:req.userId})
    .sort({ createdAt: -1 })
    .select("role experience mode finalScore status createdAt");

    return res.status(200).json(interviews)

  } catch (error) {
     return res.status(500).json({message:`failed to find currentUser Interview ${error}`})
  }
}

export const getInterviewReport = async (req,res) => {
  try {
    const interview = await Interview.findById(req.params.id)

    if (!interview) {
      return res.status(404).json({ message: "Interview not found" });
    }


    const totalQuestions = interview.questions.length;

    let totalConfidence = 0;
    let totalCommunication = 0;
    let totalCorrectness = 0;

    interview.questions.forEach((q) => {
      totalConfidence += q.confidence || 0;
      totalCommunication += q.communication || 0;
      totalCorrectness += q.correctness || 0;
    });
    const avgConfidence = totalQuestions
      ? totalConfidence / totalQuestions
      : 0;

    const avgCommunication = totalQuestions
      ? totalCommunication / totalQuestions
      : 0;

    const avgCorrectness = totalQuestions
      ? totalCorrectness / totalQuestions
      : 0;

       return res.json({
      finalScore: interview.finalScore,
      confidence: Number(avgConfidence.toFixed(1)),
      communication: Number(avgCommunication.toFixed(1)),
      correctness: Number(avgCorrectness.toFixed(1)),
      questionWiseScore: interview.questions
    });

  } catch (error) {
    return res.status(500).json({message:`failed to find currentUser Interview report ${error}`})
  }
}


/**
 * POST /api/interview/tts
 * Converts a piece of text to Sarvam AI audio.
 * Returns { audioBase64 } — a WAV file encoded as base64.
 */
export const speakQuestion = async (req, res) => {
  try {
    const { text, gender } = req.body;

    if (!text || typeof text !== "string" || text.trim().length === 0) {
      return res.status(400).json({ message: "text is required" });
    }

    const audioBase64 = await textToSpeech(text.trim(), gender || "female");

    return res.status(200).json({ audioBase64 });
  } catch (error) {
    console.error("Sarvam TTS error:", error.response?.data || error.message);
    return res.status(500).json({ message: "TTS failed", error: error.message });
  }
};
