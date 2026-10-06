import React, { useState, useRef, useEffect, useCallback } from 'react'
import maleVideo from "../assets/videos/male-ai.mp4"
import femaleVideo from "../assets/videos/female-ai.mp4"
import Timer from './Timer'
import { motion } from "motion/react"
import { FaMicrophone, FaMicrophoneSlash } from "react-icons/fa"
import axios from "axios"
import { ServerUrl } from '../config'
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
  const [voiceGender]                   = useState("female"); // female → ritu | male → aditya
  const [subtitle, setSubtitle]         = useState("");
  const [submitError, setSubmitError]   = useState("");

  const videoRef       = useRef(null);
  const audioRef       = useRef(null);   // Sarvam AI audio element
  const objectUrlRef   = useRef(null);   // blob URL backing the current audio
  const recognitionRef = useRef(null);
  const isSpeakingRef  = useRef(false);  // true while the AI is talking
  const speechIdRef    = useRef(0);      // invalidates superseded utterances
  const settleRef      = useRef(null);   // resolver of the in-flight speakText
  const shouldListenRef = useRef(false); // whether the mic should be running
  const sequenceRef    = useRef(null);   // guards the StrictMode double-invoke
  const runGenRef      = useRef(0);      // retires a superseded speech sequence

  const currentQuestion = questions[currentIndex];
  const videoSource     = voiceGender === "male" ? maleVideo : femaleVideo;

  /* ─────────────────────────────────────────────
     SARVAM AI — Text-to-Speech
     Calls backend /api/interview/tts which returns
     a base64 WAV rendered by Sarvam bulbul:v3.
  ───────────────────────────────────────────── */

  /**
   * Stop whatever is currently playing and settle its promise.
   *
   * Pausing an <audio> fires no "ended" event, so an awaited speakText used
   * to hang forever once it was interrupted — which left the Submit button
   * stuck on "Submitting..." and allowed a second clip to play over the top.
   */
  const stopSpeaking = useCallback(() => {
    speechIdRef.current += 1; // any in-flight synthesis is now stale

    if (audioRef.current) {
      audioRef.current.onended = null;
      audioRef.current.onerror = null;
      audioRef.current.pause();
      audioRef.current = null;
    }
    if (objectUrlRef.current) {
      URL.revokeObjectURL(objectUrlRef.current);
      objectUrlRef.current = null;
    }

    videoRef.current?.pause();
    if (videoRef.current) videoRef.current.currentTime = 0;

    isSpeakingRef.current = false;
    setIsAIPlaying(false);
    setSubtitle("");

    const settle = settleRef.current;
    settleRef.current = null;
    settle?.();
  }, []);

  const speakText = useCallback((text) => {
    if (!text?.trim()) return Promise.resolve();

    // Interrupt anything already speaking, resolving its promise first.
    stopSpeaking();

    const myId = speechIdRef.current;

    return new Promise((resolve) => {
      settleRef.current = resolve;

      const settle = () => {
        if (settleRef.current === resolve) settleRef.current = null;
        resolve();
      };

      const finish = () => {
        // A newer utterance already took over and cleaned up after us.
        if (speechIdRef.current !== myId) { settle(); return; }

        if (objectUrlRef.current) {
          URL.revokeObjectURL(objectUrlRef.current);
          objectUrlRef.current = null;
        }
        audioRef.current = null;
        videoRef.current?.pause();
        if (videoRef.current) videoRef.current.currentTime = 0;
        isSpeakingRef.current = false;
        setIsAIPlaying(false);
        setSubtitle("");
        settle();
      };

      isSpeakingRef.current = true;
      setSubtitle(text);
      setIsAIPlaying(true);
      stopMic();
      videoRef.current?.play().catch(() => {});

      axios
        .post(ServerUrl + "/api/interview/tts", { text, gender: voiceGender }, { withCredentials: true })
        .then(({ data }) => {
          // Superseded while the audio was being synthesised — drop it rather
          // than start a second voice on top of the current one.
          if (speechIdRef.current !== myId) { settle(); return; }

          const bytes = Uint8Array.from(atob(data.audioBase64), c => c.charCodeAt(0));
          const url   = URL.createObjectURL(new Blob([bytes], { type: "audio/wav" }));
          const audio = new Audio(url);

          objectUrlRef.current = url;
          audioRef.current     = audio;

          audio.onended = finish;
          audio.onerror = finish;
          audio.play().catch(finish);
        })
        .catch(finish); // fail gracefully — the interview continues
    });
  }, [stopSpeaking, voiceGender]);

  /* ─────────────────────────────────────────────
     BROWSER STT — microphone → answer textarea
  ───────────────────────────────────────────── */
  useEffect(() => {
    const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
    if (!SpeechRecognition) return;

    const r          = new SpeechRecognition();
    r.lang           = "en-US";
    r.continuous     = true;
    r.interimResults = false;

    r.onresult = (e) => {
      const t = e.results[e.results.length - 1][0].transcript.trim();
      if (!t) return;
      setAnswer(prev => (prev ? prev + " " : "") + t);
    };

    // Chrome ends recognition on its own after a short silence. Without this
    // the mic looks on but captures nothing, so answers arrived empty.
    r.onend = () => {
      if (shouldListenRef.current && !isSpeakingRef.current) {
        try { r.start(); } catch { /* already starting */ }
      }
    };

    r.onerror = (e) => {
      // "no-speech"/"aborted" are routine; onend will restart us.
      if (e.error === "not-allowed" || e.error === "service-not-allowed") {
        shouldListenRef.current = false;
        setIsMicOn(false);
        setSubmitError("Microphone access was blocked. You can still type your answer.");
      }
    };

    recognitionRef.current = r;

    return () => {
      shouldListenRef.current = false;
      r.onend = null;
      try { r.abort(); } catch { /* not running */ }
    };
  }, []);

  const startMic = () => {
    if (!recognitionRef.current || isSpeakingRef.current) return;
    shouldListenRef.current = true;
    try { recognitionRef.current.start(); } catch { /* already running */ }
  };

  const stopMic = () => {
    shouldListenRef.current = false;
    if (recognitionRef.current) {
      try { recognitionRef.current.stop(); } catch { /* not running */ }
    }
  };

  const toggleMic = () => {
    if (isMicOn) stopMic(); else startMic();
    setIsMicOn(prev => !prev);
  };

  /* ─────────────────────────────────────────────
     INTRO → QUESTIONS sequence
  ───────────────────────────────────────────── */
  useEffect(() => {
    // StrictMode invokes effects twice in development. Guarding on the step
    // keeps the sequence to a single run; cancellation is tracked by
    // generation rather than by cleanup, which StrictMode also fires
    // spuriously (that would abort the only real run).
    const step = isIntroPhase ? "intro" : currentIndex;
    if (sequenceRef.current === step) return;
    sequenceRef.current = step;

    runGenRef.current += 1;
    const myGen = runGenRef.current;
    const alive = () => runGenRef.current === myGen;

    // Stop feeding the queue as soon as a later step has taken over, so a
    // retired sequence can never talk over the current question.
    const say = async (text) => { if (alive()) await speakText(text); };

    const run = async () => {
      if (isIntroPhase) {
        await say(`Hi ${userName}, it's great to meet you today. I hope you're feeling confident and ready.`);
        await say("I'll ask you a few questions. Just answer naturally, and take your time. Let's begin.");
        if (alive()) setIsIntroPhase(false);
        return;
      }

      if (!currentQuestion) return;

      await new Promise(r => setTimeout(r, 600));
      if (currentIndex > 0) await say("Alright, let's move to the next question.");
      if (currentIndex === questions.length - 1) await say("This one might be a bit more challenging.");
      await say(currentQuestion.question);

      // Only open the mic once the AI has actually stopped talking, so its
      // own voice is never captured as the candidate's answer.
      if (alive() && isMicOn) startMic();
    };

    run();
  }, [isIntroPhase, currentIndex]); // eslint-disable-line react-hooks/exhaustive-deps

  /* ─────────────────────────────────────────────
     COUNTDOWN TIMER
  ───────────────────────────────────────────── */
  useEffect(() => {
    // Hold the countdown while the AI is talking and once the answer has been
    // graded — the candidate should not lose answering time to the AI's voice.
    if (isIntroPhase || !currentQuestion || isAIPlaying || feedback || isSubmitting) return;

    const t = setInterval(() => {
      setTimeLeft(prev => { if (prev <= 1) { clearInterval(t); return 0; } return prev - 1; });
    }, 1000);
    return () => clearInterval(t);
  }, [isIntroPhase, currentIndex, isAIPlaying, feedback, isSubmitting, currentQuestion]);

  useEffect(() => {
    if (!isIntroPhase && currentQuestion) setTimeLeft(currentQuestion.timeLimit || 60);
  }, [currentIndex, isIntroPhase, currentQuestion]);

  useEffect(() => {
    if (!isIntroPhase && currentQuestion && timeLeft === 0 && !isSubmitting && !feedback) {
      handleSubmitAnswer({ auto: true });
    }
  }, [timeLeft]); // eslint-disable-line react-hooks/exhaustive-deps

  /* ─────────────────────────────────────────────
     SUBMIT ANSWER
  ───────────────────────────────────────────── */
  const handleSubmitAnswer = async ({ auto = false } = {}) => {
    if (isSubmitting || feedback) return;

    // A manual submit with an empty box is almost always a mistake (a muted
    // mic, or speech that never got captured). Let the timeout submit blanks.
    if (!auto && !answer.trim()) {
      setSubmitError("Please record or type an answer before submitting.");
      return;
    }

    stopMic();
    setSubmitError("");
    setIsSubmitting(true);

    try {
      const result = await axios.post(
        ServerUrl + "/api/interview/submit-answer",
        { interviewId, questionIndex: currentIndex, answer, timeTaken: currentQuestion.timeLimit - timeLeft },
        { withCredentials: true }
      );

      const fb = result.data.feedback;
      setFeedback(fb);
      // Deliberately not awaited: the button must never wait on audio.
      speakText(fb);
    } catch (err) {
      console.error(err);
      setSubmitError(err?.response?.data?.message || "Failed to submit answer. Please try again.");
    } finally {
      setIsSubmitting(false);
    }
  };

  /* ─────────────────────────────────────────────
     NEXT QUESTION / FINISH
  ───────────────────────────────────────────── */
  const handleNext = async () => {
    stopSpeaking(); // cut the feedback audio short rather than letting it overlap
    setAnswer("");
    setFeedback("");
    setSubmitError("");

    if (currentIndex + 1 >= questions.length) {
      await handleFinishInterview();
      return;
    }

    // The speech sequence effect handles the transition line, the question,
    // and re-opening the mic once the audio has finished.
    setCurrentIndex(currentIndex + 1);
  };

  const handleFinishInterview = async () => {
    stopSpeaking();
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
      shouldListenRef.current = false;
      stopSpeaking();
    };
  }, [stopSpeaking]);

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
              {isAIPlaying && (
                <span className='text-xs font-medium text-gray-400'>timer paused</span>
              )}
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

          {submitError && (
            <div className='mt-4 bg-red-50 border border-red-200 text-red-600 text-sm px-4 py-3 rounded-xl'>
              {submitError}
            </div>
          )}

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
                onClick={() => handleSubmitAnswer()}
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
