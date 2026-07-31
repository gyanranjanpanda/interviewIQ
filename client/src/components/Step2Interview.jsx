import React, { useState, useRef, useEffect, useCallback } from 'react'
import maleVideo from "../assets/videos/male-ai.mp4"
import femaleVideo from "../assets/videos/female-ai.mp4"
import Timer from './Timer'
import { motion } from "motion/react"
import { FaMicrophone, FaMicrophoneSlash } from "react-icons/fa"
import axios from "axios"
import { ServerUrl } from '../App'
import { BsArrowRight } from 'react-icons/bs'

function Step2Interview({ interviewData, onFinish }) {
  const { interviewId, questions, userName } = interviewData;

  const [isIntroPhase, setIsIntroPhase] = useState(true);
  const [isMicOn, setIsMicOn]           = useState(true);
  const [isAIPlaying, setIsAIPlaying]   = useState(false);
  const [currentIndex, setCurrentIndex] = useState(0);
  const [answer, setAnswer]             = useState("");
  const [feedback, setFeedback]         = useState("");
  const [timeLeft, setTimeLeft]         = useState(questions[0]?.timeLimit || 60);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [voiceGender]                   = useState("female"); // female → anushka | male → aditya
  const [subtitle, setSubtitle]         = useState("");

  const videoRef       = useRef(null);
  const audioRef       = useRef(null);   // Sarvam AI audio element
  const recognitionRef = useRef(null);
  const isSpeakingRef  = useRef(false);  // prevents overlapping TTS calls

  const currentQuestion = questions[currentIndex];
  const videoSource     = voiceGender === "male" ? maleVideo : femaleVideo;

  /* ─────────────────────────────────────────────
     SARVAM AI — Text-to-Speech
     Calls backend /api/interview/tts which uses
     Sarvam bulbul:v2 model and returns base64 WAV
  ───────────────────────────────────────────── */
  const speakText = useCallback((text) => {
    return new Promise(async (resolve) => {
      if (!text?.trim()) { resolve(); return; }

      // Stop any currently playing audio
      if (audioRef.current) {
        audioRef.current.pause();
        audioRef.current.currentTime = 0;
      }
      isSpeakingRef.current = true;

      setSubtitle(text);
      setIsAIPlaying(true);
      stopMic();
      videoRef.current?.play();

      try {
        const { data } = await axios.post(
          ServerUrl + "/api/interview/tts",
          { text, gender: voiceGender },
          { withCredentials: true }
        );

        const bytes = Uint8Array.from(atob(data.audioBase64), c => c.charCodeAt(0));
        const blob  = new Blob([bytes], { type: "audio/wav" });
        const url   = URL.createObjectURL(blob);
        const audio = new Audio(url);
        audioRef.current = audio;

        const cleanup = () => {
          URL.revokeObjectURL(url);
          videoRef.current?.pause();
          if (videoRef.current) videoRef.current.currentTime = 0;
          setIsAIPlaying(false);
          setSubtitle("");
          isSpeakingRef.current = false;
        };

        audio.onended = () => { cleanup(); resolve(); };
        audio.onerror = () => { cleanup(); resolve(); };

        audio.play().catch(() => { cleanup(); resolve(); });

      } catch {
        videoRef.current?.pause();
        setIsAIPlaying(false);
        setSubtitle("");
        isSpeakingRef.current = false;
        resolve(); // fail gracefully — interview continues
      }
    });
  }, [voiceGender]); // eslint-disable-line react-hooks/exhaustive-deps

  /* ─────────────────────────────────────────────
     BROWSER STT — microphone → answer textarea
  ───────────────────────────────────────────── */
  useEffect(() => {
    if (!("webkitSpeechRecognition" in window)) return;
    const r        = new window.webkitSpeechRecognition();
    r.lang         = "en-US";
    r.continuous   = true;
    r.interimResults = false;
    r.onresult = (e) => {
      const t = e.results[e.results.length - 1][0].transcript;
      setAnswer(prev => prev + " " + t);
    };
    recognitionRef.current = r;
  }, []);

  const startMic = () => {
    if (recognitionRef.current && !isSpeakingRef.current) {
      try { recognitionRef.current.start(); } catch {}
    }
  };

  const stopMic = () => {
    if (recognitionRef.current) {
      try { recognitionRef.current.stop(); } catch {}
    }
  };

  const toggleMic = () => {
    isMicOn ? stopMic() : startMic();
    setIsMicOn(prev => !prev);
  };

  /* ─────────────────────────────────────────────
     INTRO → QUESTIONS sequence
  ───────────────────────────────────────────── */
  useEffect(() => {
    const run = async () => {
      if (isIntroPhase) {
        await speakText(`Hi ${userName}, it's great to meet you today. I hope you're feeling confident and ready.`);
        await speakText("I'll ask you a few questions. Just answer naturally, and take your time. Let's begin.");
        setIsIntroPhase(false);
      } else if (currentQuestion) {
        await new Promise(r => setTimeout(r, 800));
        if (currentIndex === questions.length - 1) {
          await speakText("Alright, this one might be a bit more challenging.");
        }
        await speakText(currentQuestion.question);
        if (isMicOn) startMic();
      }
    };
    run();
  }, [isIntroPhase, currentIndex]); // eslint-disable-line react-hooks/exhaustive-deps

  /* ─────────────────────────────────────────────
     COUNTDOWN TIMER
  ───────────────────────────────────────────── */
  useEffect(() => {
    if (isIntroPhase || !currentQuestion) return;
    const t = setInterval(() => {
      setTimeLeft(prev => { if (prev <= 1) { clearInterval(t); return 0; } return prev - 1; });
    }, 1000);
    return () => clearInterval(t);
  }, [isIntroPhase, currentIndex]);

  useEffect(() => {
    if (!isIntroPhase && currentQuestion) setTimeLeft(currentQuestion.timeLimit || 60);
  }, [currentIndex]);

  useEffect(() => {
    if (!isIntroPhase && currentQuestion && timeLeft === 0 && !isSubmitting && !feedback) {
      handleSubmitAnswer();
    }
  }, [timeLeft]); // eslint-disable-line react-hooks/exhaustive-deps

  /* ─────────────────────────────────────────────
     SUBMIT ANSWER
  ───────────────────────────────────────────── */
  const handleSubmitAnswer = async () => {
    if (isSubmitting) return;
    stopMic();
    setIsSubmitting(true);
    try {
      const result = await axios.post(
        ServerUrl + "/api/interview/submit-answer",
        { interviewId, questionIndex: currentIndex, answer, timeTaken: currentQuestion.timeLimit - timeLeft },
        { withCredentials: true }
      );
      const fb = result.data.feedback;
      setFeedback(fb);
      await speakText(fb);
    } catch (err) {
      console.error(err);
    } finally {
      setIsSubmitting(false);
    }
  };

  /* ─────────────────────────────────────────────
     NEXT QUESTION / FINISH
  ───────────────────────────────────────────── */
  const handleNext = async () => {
    setAnswer("");
    setFeedback("");
    if (currentIndex + 1 >= questions.length) {
      await handleFinishInterview();
      return;
    }
    await speakText("Alright, let's move to the next question.");
    setCurrentIndex(currentIndex + 1);
    setTimeout(() => { if (isMicOn) startMic(); }, 500);
  };

  const handleFinishInterview = async () => {
    stopMic();
    setIsMicOn(false);
    try {
      const result = await axios.post(
        ServerUrl + "/api/interview/finish",
        { interviewId },
        { withCredentials: true }
      );
      onFinish(result.data);
    } catch (err) { console.error(err); }
  };

  /* ─────────────────────────────────────────────
     CLEANUP
  ───────────────────────────────────────────── */
  useEffect(() => {
    return () => {
      recognitionRef.current?.stop();
      recognitionRef.current?.abort();
      audioRef.current?.pause();
    };
  }, []);

  /* ─────────────────────────────────────────────
     RENDER
  ───────────────────────────────────────────── */
  return (
    <div className='min-h-screen bg-linear-to-br from-emerald-50 via-white to-teal-100 flex items-center justify-center p-4 sm:p-6'>
      <div className='w-full max-w-350 min-h-[80vh] bg-white rounded-3xl shadow-2xl border border-gray-200 flex flex-col lg:flex-row overflow-hidden'>

        {/* ── AI Avatar + Status Panel ── */}
        <div className='w-full lg:w-[35%] bg-white flex flex-col items-center p-6 space-y-6 border-r border-gray-200'>

          {/* Video */}
          <div className='w-full max-w-md rounded-2xl overflow-hidden shadow-xl'>
            <video
              src={videoSource}
              key={videoSource}
              ref={videoRef}
              muted
              playsInline
              preload="auto"
              className="w-full h-auto object-cover"
            />
          </div>

          {/* Animated sound-wave while AI speaks */}
          {isAIPlaying && (
            <div className='flex items-center gap-1'>
              {[1,2,3,4,5].map(i => (
                <motion.div
                  key={i}
                  className='w-1.5 rounded-full bg-emerald-500'
                  animate={{ height: ["6px","22px","6px"] }}
                  transition={{ duration: 0.55, repeat: Infinity, delay: i * 0.1, ease: "easeInOut" }}
                />
              ))}
              <span className='ml-2 text-xs font-semibold text-emerald-600'>AI Speaking</span>
            </div>
          )}

          {/* Subtitle */}
          {subtitle && (
            <motion.div
              initial={{ opacity: 0, y: 6 }}
              animate={{ opacity: 1, y: 0 }}
              className='w-full max-w-md bg-gray-50 border border-gray-200 rounded-xl p-4 shadow-sm'
            >
              <p className='text-gray-700 text-sm font-medium text-center leading-relaxed'>{subtitle}</p>
            </motion.div>
          )}

          {/* Timer & counters */}
          <div className='w-full max-w-md bg-white border border-gray-200 rounded-2xl shadow-md p-6 space-y-5'>
            <div className='flex justify-between items-center'>
              <span className='text-sm text-gray-500'>Interview Status</span>
            </div>
            <div className="h-px bg-gray-200" />
            <div className='flex justify-center'>
              <Timer timeLeft={timeLeft} totalTime={currentQuestion?.timeLimit} />
            </div>
            <div className="h-px bg-gray-200" />
            <div className='grid grid-cols-2 gap-6 text-center'>
              <div>
                <span className='text-2xl font-bold text-emerald-600'>{currentIndex + 1}</span>
                <p className='text-xs text-gray-400'>Current Question</p>
              </div>
              <div>
                <span className='text-2xl font-bold text-emerald-600'>{questions.length}</span>
                <p className='text-xs text-gray-400'>Total Questions</p>
              </div>
            </div>
          </div>
        </div>

        {/* ── Answer Panel ── */}
        <div className='flex-1 flex flex-col p-4 sm:p-6 md:p-8 relative'>
          <h2 className='text-xl sm:text-2xl font-bold text-emerald-600 mb-6'>AI Smart Interview</h2>

          {!isIntroPhase && (
            <div className='relative mb-6 bg-gray-50 p-4 sm:p-6 rounded-2xl border border-gray-200 shadow-sm'>
              <p className='text-xs sm:text-sm text-gray-400 mb-2'>
                Question {currentIndex + 1} of {questions.length}
              </p>
              <div className='text-base sm:text-lg font-semibold text-gray-800 leading-relaxed'>
                {currentQuestion?.question}
              </div>
            </div>
          )}

          <textarea
            placeholder="Type your answer here..."
            onChange={(e) => setAnswer(e.target.value)}
            value={answer}
            className="flex-1 bg-gray-100 p-4 sm:p-6 rounded-2xl resize-none outline-none border border-gray-200 focus:ring-2 focus:ring-emerald-500 transition text-gray-800"
          />

          {!feedback ? (
            <div className='flex items-center gap-4 mt-6'>
              <motion.button
                onClick={toggleMic}
                whileTap={{ scale: 0.9 }}
                title={isMicOn ? "Mute mic" : "Unmute mic"}
                className={`w-12 h-12 sm:w-14 sm:h-14 flex items-center justify-center rounded-full shadow-lg transition ${isMicOn ? "bg-black text-white" : "bg-gray-200 text-gray-500"}`}
              >
                {isMicOn ? <FaMicrophone size={20} /> : <FaMicrophoneSlash size={20} />}
              </motion.button>

              <motion.button
                onClick={handleSubmitAnswer}
                disabled={isSubmitting}
                whileTap={{ scale: 0.95 }}
                className='flex-1 bg-gradient-to-r from-emerald-600 to-teal-500 text-white py-3 sm:py-4 rounded-2xl shadow-lg hover:opacity-90 transition font-semibold disabled:bg-gray-400'
              >
                {isSubmitting ? "Submitting..." : "Submit Answer"}
              </motion.button>
            </div>
          ) : (
            <motion.div
              initial={{ opacity: 0, y: 8 }}
              animate={{ opacity: 1, y: 0 }}
              className='mt-6 bg-emerald-50 border border-emerald-200 p-5 rounded-2xl shadow-sm'
            >
              <p className='text-emerald-700 font-medium mb-4'>{feedback}</p>
              <button
                onClick={handleNext}
                className='w-full bg-gradient-to-r from-emerald-600 to-teal-500 text-white py-3 rounded-xl shadow-md hover:opacity-90 transition flex items-center justify-center gap-1'
              >
                Next Question <BsArrowRight size={18} />
              </button>
            </motion.div>
          )}
        </div>
      </div>
    </div>
  );
}

export default Step2Interview
