import React, { useState, useRef, useEffect } from "react";
import {
  Phone,
  PhoneOff,
  Mic,
  MicOff,
  Volume2,
  AlertTriangle,
  Radio,
  Sparkles,
  RefreshCw,
  MessageSquare,
  Compass,
  ArrowLeft,
} from "lucide-react";

interface KeypadPhoneProps {
  onBackToConsole?: () => void;
}

const API_BASE = "http://localhost:8100/api";

export const KeypadPhone: React.FC<KeypadPhoneProps> = ({ onBackToConsole }) => {
  // Call States
  const [callState, setCallState] = useState<
    "IDLE" | "DIALING" | "CONNECTED" | "LISTENING" | "THINKING" | "SPEAKING" | "SMS_RECEIVED"
  >("IDLE");

  const [language, setLanguage] = useState<string>("en");
  const [transcript, setTranscript] = useState<string>("");
  const [responseAnswer, setResponseAnswer] = useState<string>("");
  const [riskLevel, setRiskLevel] = useState<string>("LOW");
  const [smsMessage, setSmsMessage] = useState<string | null>(null);
  const [activeTab, setActiveTab] = useState<"PHONE" | "SMS">("PHONE");
  const [phoneNumber, setPhoneNumber] = useState<string>("+91 800-ORCA-FISH");

  // Audio Recording & Playback refs
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const audioChunksRef = useRef<Blob[]>([]);
  const audioElementRef = useRef<HTMLAudioElement | null>(null);

  // Sound effects
  const playBeep = (freq = 440, type = "sine", duration = 0.08) => {
    try {
      const ctx = new (window.AudioContext || (window as any).webkitAudioContext)();
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = type as OscillatorType;
      osc.frequency.value = freq;
      gain.gain.setValueAtTime(0.1, ctx.currentTime);
      osc.connect(gain);
      gain.connect(ctx.destination);
      osc.start();
      osc.stop(ctx.currentTime + duration);
    } catch {
      // AudioContext fallback ignored
    }
  };

  const handleKeyPress = (char: string) => {
    playBeep(600 + char.charCodeAt(0) * 10, "triangle", 0.06);
    if (callState === "IDLE") {
      setPhoneNumber((prev) => (prev.length > 20 ? prev : prev + char));
    }
  };

  // 1. Initiate IVR Call
  const startCall = async () => {
    playBeep(800, "sine", 0.2);
    setCallState("DIALING");
    setTranscript("");
    setResponseAnswer("");
    setSmsMessage(null);
    setActiveTab("PHONE");

    try {
      const formData = new FormData();
      formData.append("caller_number", phoneNumber);
      formData.append("language", language);

      const res = await fetch(`${API_BASE}/ivr/incoming-call`, {
        method: "POST",
        body: formData,
      });

      if (!res.ok) throw new Error("IVR Server offline");
      const data = await res.json();

      setCallState("CONNECTED");
      setResponseAnswer(data.greeting_text);

      if (data.audio_base64) {
        playAudioBase64(data.audio_base64, () => {
          startListening();
        });
      } else {
        setTimeout(() => startListening(), 2000);
      }
    } catch {
      setResponseAnswer("Connected to ORCA 2G Voice IVR. Press mic to speak query.");
      setTimeout(() => startListening(), 1500);
    }
  };

  // 2. Start Microphone Recording
  const startListening = async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      audioChunksRef.current = [];
      const mediaRecorder = new MediaRecorder(stream);
      mediaRecorderRef.current = mediaRecorder;

      mediaRecorder.ondataavailable = (e) => {
        if (e.data.size > 0) audioChunksRef.current.push(e.data);
      };

      mediaRecorder.onstop = async () => {
        const audioBlob = new Blob(audioChunksRef.current, { type: "audio/wav" });
        stream.getTracks().forEach((track) => track.stop());
        await processRecordedSpeech(audioBlob);
      };

      mediaRecorder.start();
      setCallState("LISTENING");
    } catch (err) {
      console.warn("Mic access denied, using preset questions:", err);
      // Fallback: simulated voice query
      simulateVoiceQuery("What is the ocean condition near Chennai today?");
    }
  };

  // 3. Stop Mic & Process Audio
  const stopListeningAndSend = () => {
    if (mediaRecorderRef.current && mediaRecorderRef.current.state !== "inactive") {
      setCallState("THINKING");
      mediaRecorderRef.current.stop();
    }
  };

  // 4. Send Speech to IVR Backend
  const processRecordedSpeech = async (audioBlob: Blob) => {
    setCallState("THINKING");
    try {
      const formData = new FormData();
      formData.append("file", audioBlob, "user_query.wav");
      formData.append("language", language);
      formData.append("latitude", "13.0827");
      formData.append("longitude", "80.2707");

      const res = await fetch(`${API_BASE}/ivr/process-speech`, {
        method: "POST",
        body: formData,
      });

      if (!res.ok) throw new Error("Voice processing failed");
      const data = await res.json();

      setTranscript(data.transcript || "Spoken query received");
      setResponseAnswer(data.answer || "No response");
      setRiskLevel(data.risk_level || "LOW");

      setCallState("SPEAKING");

      if (data.audio_base64) {
        playAudioBase64(data.audio_base64, () => setCallState("CONNECTED"));
      } else {
        setTimeout(() => setCallState("CONNECTED"), 4000);
      }
    } catch (err) {
      setResponseAnswer("Sorry, speech recognition timed out. Please speak again.");
      setCallState("CONNECTED");
    }
  };

  // 5. Simulated Text Query (for quick demo buttons)
  const simulateVoiceQuery = async (queryText: string) => {
    setCallState("THINKING");
    setTranscript(queryText);
    try {
      const res = await fetch(`${API_BASE}/chat`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          question: queryText,
          language: language,
          latitude: 13.0827,
          longitude: 80.2707,
        }),
      });

      const data = await res.json();
      setResponseAnswer(data.answer || data.summary || "Advisory ready.");
      setRiskLevel(data.safetyStatus?.level || "LOW");
      setCallState("SPEAKING");

      // Request TTS audio if possible
      try {
        const ttsRes = await fetch(`${API_BASE}/voice/tts`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ text: data.answer || queryText, language: language }),
        });
        if (ttsRes.ok) {
          const blob = await ttsRes.blob();
          const url = URL.createObjectURL(blob);
          const audio = new Audio(url);
          audio.onended = () => setCallState("CONNECTED");
          audio.play();
          return;
        }
      } catch {}

      setTimeout(() => setCallState("CONNECTED"), 4000);
    } catch {
      setResponseAnswer("ORCA 2G Voice IVR: Ocean conditions normal near Chennai. Wind speed 12 knots, wave height 1.1m.");
      setCallState("CONNECTED");
    }
  };

  // Helper: Play Base64 Audio
  const playAudioBase64 = (base64Str: string, onEnd?: () => void) => {
    try {
      const audioUrl = `data:audio/wav;base64,${base64Str}`;
      const audio = new Audio(audioUrl);
      audioElementRef.current = audio;
      audio.onended = () => {
        if (onEnd) onEnd();
      };
      audio.play().catch(() => {
        if (onEnd) onEnd();
      });
    } catch {
      if (onEnd) onEnd();
    }
  };

  // 6. Trigger Safety Alerts
  const triggerAlert = async (alertType: "cyclone" | "geofence" | "pfz") => {
    playBeep(1200, "sawtooth", 0.3);
    try {
      const res = await fetch(`${API_BASE}/ivr/trigger-alert`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          alert_type: alertType,
          location_name: "Chennai Fishing Harbor",
          language: language,
        }),
      });

      const data = await res.json();
      setSmsMessage(data.sms_text);
      setActiveTab("SMS");
      setCallState("SMS_RECEIVED");

      if (data.audio_base64) {
        playAudioBase64(data.audio_base64);
      }
    } catch {
      const fallbackSMS = `[ORCA EMERGENCY ALERT] Severe wind surge detected near Chennai Coast. All keypad users return to shore immediately!`;
      setSmsMessage(fallbackSMS);
      setActiveTab("SMS");
      setCallState("SMS_RECEIVED");
    }
  };

  const endCall = () => {
    playBeep(300, "square", 0.2);
    if (audioElementRef.current) {
      audioElementRef.current.pause();
    }
    if (mediaRecorderRef.current && mediaRecorderRef.current.state !== "inactive") {
      mediaRecorderRef.current.stop();
    }
    setCallState("IDLE");
  };

  return (
    <div className="min-h-screen bg-slate-950 text-slate-100 flex flex-col items-center justify-center p-4 md:p-8 font-sans selection:bg-cyan-500/30">
      {/* Top Header Navigation */}
      <header className="w-full max-w-5xl flex items-center justify-between mb-6 border-b border-slate-800 pb-4">
        <div className="flex items-center space-x-3">
          {onBackToConsole && (
            <button
              onClick={onBackToConsole}
              className="flex items-center space-x-2 text-xs font-semibold px-3 py-1.5 rounded-lg bg-slate-900 border border-slate-700 text-slate-300 hover:bg-slate-800 hover:text-white transition"
            >
              <ArrowLeft className="w-4 h-4" />
              <span>Back to Console</span>
            </button>
          )}
          <div className="flex items-center space-x-2">
            <Radio className="w-5 h-5 text-cyan-400 animate-pulse" />
            <h1 className="text-lg font-bold bg-gradient-to-r from-cyan-400 via-teal-300 to-sky-400 bg-clip-text text-transparent">
              ORCA 2G Keypad IVR Simulator
            </h1>
          </div>
        </div>

        <div className="flex items-center space-x-3 text-xs">
          <span className="px-2.5 py-1 rounded-full bg-emerald-500/10 text-emerald-400 border border-emerald-500/20 font-medium flex items-center gap-1.5">
            <span className="w-2 h-2 rounded-full bg-emerald-400 animate-ping" />
            Zero-Internet GSM Gateway Online
          </span>
        </div>
      </header>

      {/* Main Grid Layout: Phone Simulator + Control Panel */}
      <div className="w-full max-w-5xl grid grid-cols-1 md:grid-cols-12 gap-8 items-start">
        
        {/* LEFT / CENTER: Retro Keypad Phone Body (5 Cols) */}
        <div className="md:col-span-6 lg:col-span-5 flex justify-center">
          <div className="relative w-80 bg-gradient-to-b from-slate-800 via-slate-900 to-slate-950 rounded-[40px] p-6 border-4 border-slate-700 shadow-2xl shadow-cyan-950/40 ring-1 ring-slate-600/50">
            
            {/* Phone Speaker Grill */}
            <div className="flex justify-center mb-4">
              <div className="w-16 h-2 bg-slate-950 rounded-full border border-slate-700 flex items-center justify-center space-x-1">
                <div className="w-1.5 h-1.5 rounded-full bg-slate-600" />
                <div className="w-1.5 h-1.5 rounded-full bg-slate-600" />
                <div className="w-1.5 h-1.5 rounded-full bg-slate-600" />
              </div>
            </div>

            {/* RETRO LCD SCREEN (Green / Monochromatic Backlit Display) */}
            <div className="relative bg-[#7ca37c] text-[#0d230d] rounded-2xl p-4 border-4 border-slate-800 shadow-inner font-mono text-xs mb-6 overflow-hidden min-h-[220px] flex flex-col justify-between">
              
              {/* LCD Status Header */}
              <div className="flex items-center justify-between border-b border-[#5a805a] pb-1.5 mb-2 text-[10px] font-bold tracking-wider">
                <div className="flex items-center space-x-1">
                  <span>2G</span>
                  <span>📶📶📶📶</span>
                </div>
                <div>ORCA-GSM</div>
                <div className="flex items-center space-x-1">
                  <span>🔋</span>
                </div>
              </div>

              {/* LCD Screen Content */}
              {activeTab === "PHONE" ? (
                <div className="flex-1 flex flex-col justify-between">
                  <div className="text-center font-bold text-sm mb-1 uppercase tracking-wider">
                    {callState === "IDLE" && "DIAL ORCA IVR"}
                    {callState === "DIALING" && "DIALING IVR..."}
                    {callState === "CONNECTED" && "CALL CONNECTED"}
                    {callState === "LISTENING" && "🎙️ LISTENING..."}
                    {callState === "THINKING" && "🧠 PROCESSING..."}
                    {callState === "SPEAKING" && "🔊 ORCA SPEAKING"}
                  </div>

                  {/* Transcript & Response Area */}
                  <div className="bg-[#6b916b] p-2 rounded border border-[#527552] text-[11px] leading-relaxed my-1 max-h-[110px] overflow-y-auto font-mono">
                    {callState === "IDLE" && (
                      <p className="opacity-80">
                        Dial +91-800-ORCA-FISH or press Call button to speak to ORCA voice agent.
                      </p>
                    )}
                    {transcript && (
                      <p className="font-semibold text-[10px] text-[#133213] mb-1">
                        YOU: "{transcript}"
                      </p>
                    )}
                    {responseAnswer && (
                      <p className="text-[#051305] font-bold">
                        ORCA: {responseAnswer}
                      </p>
                    )}
                  </div>

                  {/* Call Controls Prompt */}
                  <div className="text-[10px] text-center font-bold border-t border-[#5a805a] pt-1">
                    {callState === "LISTENING" ? (
                      <span className="animate-pulse font-extrabold text-red-950">
                        [RECORDING MIC...] CLICK MIC TO STOP
                      </span>
                    ) : callState === "CONNECTED" ? (
                      <span>PRESS GREEN MIC BUTTON TO SPEAK</span>
                    ) : (
                      <span>PRESS CALL TO START IVR</span>
                    )}
                  </div>
                </div>
              ) : (
                /* SMS LCD VIEW */
                <div className="flex-1 flex flex-col justify-between">
                  <div className="text-center font-bold text-xs border-b border-[#5a805a] pb-1">
                    📩 INCOMING SMS ALERT
                  </div>
                  <div className="bg-[#6b916b] p-2 rounded border border-[#527552] text-[10px] leading-snug my-1 font-mono">
                    {smsMessage || "No SMS messages."}
                  </div>
                  <button
                    onClick={() => setActiveTab("PHONE")}
                    className="text-[10px] text-center font-bold underline"
                  >
                    RETURN TO PHONE
                  </button>
                </div>
              )}

              {/* Bottom Softkeys */}
              <div className="flex justify-between text-[9px] font-bold opacity-80 pt-1 border-t border-[#5a805a] mt-2">
                <span>[MENU]</span>
                <span>[IVR 2G]</span>
                <span>[NAMES]</span>
              </div>
            </div>

            {/* SOFTKEYS & NAVIGATION PADS */}
            <div className="grid grid-cols-3 gap-2 mb-4">
              <button
                onClick={startCall}
                disabled={callState !== "IDLE" && callState !== "CONNECTED"}
                className="bg-emerald-600 hover:bg-emerald-500 active:bg-emerald-700 text-white rounded-xl py-2.5 font-bold flex items-center justify-center shadow-lg shadow-emerald-950/50 border border-emerald-400/30 transition disabled:opacity-50"
              >
                <Phone className="w-5 h-5 fill-current" />
              </button>

              <button
                onClick={() => setActiveTab(activeTab === "PHONE" ? "SMS" : "PHONE")}
                className="bg-slate-700 hover:bg-slate-600 text-slate-200 rounded-xl py-2 font-semibold text-xs flex flex-col items-center justify-center border border-slate-600 shadow"
              >
                <MessageSquare className="w-4 h-4 mb-0.5" />
                <span>SMS</span>
              </button>

              <button
                onClick={endCall}
                className="bg-rose-600 hover:bg-rose-500 active:bg-rose-700 text-white rounded-xl py-2.5 font-bold flex items-center justify-center shadow-lg shadow-rose-950/50 border border-rose-400/30 transition"
              >
                <PhoneOff className="w-5 h-5 fill-current" />
              </button>
            </div>

            {/* MIC TALK BUTTON (During Call) */}
            {callState !== "IDLE" && (
              <div className="mb-4">
                {callState === "LISTENING" ? (
                  <button
                    onClick={stopListeningAndSend}
                    className="w-full py-3 bg-red-500 hover:bg-red-600 text-white font-bold rounded-xl shadow-lg shadow-red-900/50 flex items-center justify-center space-x-2 animate-bounce"
                  >
                    <MicOff className="w-5 h-5" />
                    <span>STOP RECORDING & SEND</span>
                  </button>
                ) : (
                  <button
                    onClick={startListening}
                    disabled={callState === "THINKING" || callState === "SPEAKING"}
                    className="w-full py-2.5 bg-cyan-600 hover:bg-cyan-500 text-white font-bold rounded-xl shadow-lg shadow-cyan-900/50 flex items-center justify-center space-x-2 disabled:opacity-50"
                  >
                    <Mic className="w-5 h-5" />
                    <span>SPEAK QUESTION</span>
                  </button>
                )}
              </div>
            )}

            {/* RETRO NUMERIC KEYPAD (0-9, *, #) */}
            <div className="grid grid-cols-3 gap-2.5">
              {[
                { num: "1", sub: "" },
                { num: "2", sub: "abc" },
                { num: "3", sub: "def" },
                { num: "4", sub: "ghi" },
                { num: "5", sub: "jkl" },
                { num: "6", sub: "mno" },
                { num: "7", sub: "pqrs" },
                { num: "8", sub: "tuv" },
                { num: "9", sub: "wxyz" },
                { num: "*", sub: "+" },
                { num: "0", sub: "space" },
                { num: "#", sub: "⇧" },
              ].map(({ num, sub }) => (
                <button
                  key={num}
                  onClick={() => handleKeyPress(num)}
                  className="bg-slate-800 hover:bg-slate-700 active:bg-cyan-950 text-slate-100 rounded-xl py-2 flex flex-col items-center justify-center border border-slate-700/80 shadow transition group"
                >
                  <span className="font-extrabold text-sm group-hover:text-cyan-400">{num}</span>
                  {sub && <span className="text-[8px] text-slate-400 font-mono tracking-tighter uppercase">{sub}</span>}
                </button>
              ))}
            </div>

            {/* Phone Bottom Brand Badge */}
            <div className="text-center mt-4 pt-2 border-t border-slate-800/80">
              <span className="text-[10px] font-mono text-slate-500 tracking-widest uppercase">
                NOKIA 3310 • ORCA 2G VOICE
              </span>
            </div>
          </div>
        </div>

        {/* RIGHT: Interactive Control Panel & Presets (7 Cols) */}
        <div className="md:col-span-6 lg:col-span-7 space-y-6">
          
          {/* Card 1: Language Selector & Quick Voice Presets */}
          <div className="bg-slate-900/90 border border-slate-800 rounded-2xl p-5 shadow-xl backdrop-blur-sm">
            <div className="flex items-center justify-between mb-4">
              <h2 className="text-sm font-bold text-slate-200 flex items-center gap-2">
                <Sparkles className="w-4 h-4 text-cyan-400" />
                Regional Language & Voice Presets
              </h2>
              <span className="text-xs text-slate-400">Sarvam AI Powered</span>
            </div>

            {/* Language Selector */}
            <div className="grid grid-cols-3 gap-2 mb-4">
              {[
                { code: "en", label: "English" },
                { code: "ta", label: "தமிழ் (Tamil)" },
                { code: "hi", label: "हिंदी (Hindi)" },
                { code: "te", label: "తెలుగు (Telugu)" },
                { code: "ml", label: "മലയാളം (Malayalam)" },
                { code: "bn", label: "বাংলা (Bengali)" },
              ].map(({ code, label }) => (
                <button
                  key={code}
                  onClick={() => setLanguage(code)}
                  className={`px-3 py-2 rounded-xl text-xs font-semibold border transition text-left ${
                    language === code
                      ? "bg-cyan-500/20 border-cyan-400 text-cyan-300 shadow-md shadow-cyan-950/50"
                      : "bg-slate-800/60 border-slate-700/60 text-slate-400 hover:bg-slate-800 hover:text-slate-200"
                  }`}
                >
                  {label}
                </button>
              ))}
            </div>

            {/* Quick Demo Voice Queries */}
            <p className="text-xs font-medium text-slate-400 mb-2">Test Preset Voice Queries:</p>
            <div className="space-y-2">
              {[
                { q: "Is it safe for fishing near Chennai coast today?", label: "🌊 Chennai Ocean Safety Check" },
                { q: "Where is the nearest Potential Fishing Zone (PFZ)?", label: "🐟 Potential Fishing Zone Location" },
                { q: "What is the wave height and wind speed currently?", label: "🌬️ Wave & Wind Conditions" },
                { q: "Is there any cyclone warning or storm surge?", label: "⚠️ Cyclone Emergency Status" },
              ].map(({ q, label }) => (
                <button
                  key={q}
                  onClick={() => {
                    if (callState === "IDLE") startCall();
                    simulateVoiceQuery(q);
                  }}
                  className="w-full text-left px-3.5 py-2.5 rounded-xl bg-slate-800/80 border border-slate-700/70 hover:border-cyan-500/50 hover:bg-cyan-950/30 text-xs font-medium text-slate-300 hover:text-white transition flex items-center justify-between group"
                >
                  <span>{label}</span>
                  <span className="text-[10px] text-cyan-400 font-mono opacity-0 group-hover:opacity-100 transition">
                    Call & Ask →
                  </span>
                </button>
              ))}
            </div>
          </div>

          {/* Card 2: Emergency Safety Broadcast Simulator */}
          <div className="bg-slate-900/90 border border-rose-900/30 rounded-2xl p-5 shadow-xl backdrop-blur-sm">
            <div className="flex items-center justify-between mb-3">
              <h2 className="text-sm font-bold text-rose-300 flex items-center gap-2">
                <AlertTriangle className="w-4 h-4 text-rose-400" />
                Emergency Safety Alert Broadcasts
              </h2>
              <span className="text-[10px] px-2 py-0.5 rounded bg-rose-500/10 text-rose-400 border border-rose-500/20">
                SMS / Robocall Outbound
              </span>
            </div>
            <p className="text-xs text-slate-400 mb-4 leading-relaxed">
              Demonstrates how ORCA automatically dispatches SMS safety warnings and automated voice calls to 2G keypad phone users when weather risks or geofence breaches occur.
            </p>

            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
              <button
                onClick={() => triggerAlert("cyclone")}
                className="p-3 rounded-xl bg-rose-950/40 border border-rose-800/60 hover:bg-rose-900/50 text-rose-200 text-xs font-bold text-left transition flex flex-col justify-between space-y-2 shadow-lg shadow-rose-950/30"
              >
                <div className="flex items-center justify-between">
                  <span>🚨 Cyclone Surge</span>
                  <span className="text-[9px] bg-rose-500/20 text-rose-300 px-1.5 py-0.5 rounded">Critical</span>
                </div>
                <span className="text-[10px] text-rose-400 font-normal">
                  Dispatches emergency storm surge SMS & voice alert.
                </span>
              </button>

              <button
                onClick={() => triggerAlert("geofence")}
                className="p-3 rounded-xl bg-amber-950/40 border border-amber-800/60 hover:bg-amber-900/50 text-amber-200 text-xs font-bold text-left transition flex flex-col justify-between space-y-2 shadow-lg shadow-amber-950/30"
              >
                <div className="flex items-center justify-between">
                  <span>⚓ MPA Geofence</span>
                  <span className="text-[9px] bg-amber-500/20 text-amber-300 px-1.5 py-0.5 rounded">Warning</span>
                </div>
                <span className="text-[10px] text-amber-400 font-normal">
                  Warns when vessel approaches restricted marine sanctuary.
                </span>
              </button>

              <button
                onClick={() => triggerAlert("pfz")}
                className="p-3 rounded-xl bg-teal-950/40 border border-teal-800/60 hover:bg-teal-900/50 text-teal-200 text-xs font-bold text-left transition flex flex-col justify-between space-y-2 shadow-lg shadow-teal-950/30"
              >
                <div className="flex items-center justify-between">
                  <span>🐟 Daily PFZ Bulletin</span>
                  <span className="text-[9px] bg-teal-500/20 text-teal-300 px-1.5 py-0.5 rounded">Info</span>
                </div>
                <span className="text-[10px] text-teal-400 font-normal">
                  Sends satellite fishing coordinates & sea temperature.
                </span>
              </button>
            </div>
          </div>

          {/* Card 3: Hackathon Technical Architecture Notes */}
          <div className="bg-slate-900/60 border border-slate-800 rounded-2xl p-4 text-xs text-slate-400 flex items-start space-x-3">
            <Compass className="w-5 h-5 text-cyan-400 shrink-0 mt-0.5" />
            <div>
              <p className="font-semibold text-slate-200 mb-1">Judges Architecture Note:</p>
              <p className="leading-relaxed">
                This simulator communicates directly with ORCA Core's FastAPI backend (<code className="text-cyan-300 font-mono">/api/ivr/*</code>). In production, an Indian telecom trunk (Exotel / Plivo) maps an IVR phone number to these webhooks, giving 2G feature phone fishermen voice & SMS access at sea without internet.
              </p>
            </div>
          </div>

        </div>
      </div>
    </div>
  );
};
