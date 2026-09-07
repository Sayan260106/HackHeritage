import React, { useState, useEffect } from 'react';
import {
  Search,
  Mic,
  MicOff,
  Send,
  Sparkles,
  MapPin,
  Calendar,
  HelpCircle,
  Volume2,
  RefreshCw,
  Clock,
  Radio
} from 'lucide-react';
import { LanguageCode } from '../types';
import { MULTILINGUAL_DICTIONARY, COASTAL_LOCATIONS } from '../data/coastalData';
import { detectQueryLanguage } from '../utils/languageDetector';

interface QueryPanelProps {
  onSearch: (query: string, locationOverride?: string, timeOverride?: string, detectedLang?: LanguageCode) => void;
  isLoading: boolean;
  language: LanguageCode;
}

export const QueryPanel: React.FC<QueryPanelProps> = ({
  onSearch,
  isLoading,
  language
}) => {
  const [inputQuery, setInputQuery] = useState<string>('Is it safe to fish near Digha tomorrow morning?');
  const [isListening, setIsListening] = useState<boolean>(false);
  const [speechError, setSpeechError] = useState<string | null>(null);
  const [recognitionInstance, setRecognitionInstance] = useState<any>(null);
  const [selectedLocation, setSelectedLocation] = useState<string>('');
  const [selectedTime, setSelectedTime] = useState<string>('');

  const dict = MULTILINGUAL_DICTIONARY[language] || MULTILINGUAL_DICTIONARY.en;
  const detected = detectQueryLanguage(inputQuery, language);

  // Fisherman-tailored quick question chips with icon tags across languages
  const samplePrompts = [
    {
      text: 'Is it safe to go fishing near Digha right now?',
      tag: '⚓ Can I go fishing today?',
      loc: 'digha'
    },
    {
      text: 'কাল সকালে দিঘায় কি মাছ ধরা নিরাপদ?',
      tag: '🇧🇩 বাংলা: দিঘায় মাছ ধরা',
      loc: 'digha'
    },
    {
      text: 'क्या कल सुबह दीघा में मछली पकड़ना सुरक्षित है?',
      tag: '🇮🇳 हिन्दी: दीघा मौसम व सुरक्षा',
      loc: 'digha'
    },
    {
      text: 'திஹா அருகே நாளை காலை மீன்பிடிக்க பாதுகாப்பானதா?',
      tag: '🇮🇳 தமிழ்: மீன்பிடி பாதுகாப்பு',
      loc: 'digha'
    },
    {
      text: 'How high are the waves and ocean swell near Puri?',
      tag: '🌊 How high are the waves?',
      loc: 'puri'
    },
    {
      text: 'Visakhapatnam wind speed, gusts, and storm warning',
      tag: '💨 Is wind speed dangerous?',
      loc: 'visakhapatnam'
    },
    {
      text: 'Kochi sea weather and small boat advisory',
      tag: '⛈️ Any storm / rain warning?',
      loc: 'kochi'
    },
    {
      text: 'Paradeep port swell surge and craft restrictions',
      tag: '🛑 Is port advisory active?',
      loc: 'paradeep'
    },
    {
      text: 'Why has fish productivity declined in this coastal region?',
      tag: '🐟 Why did fish productivity decline?',
      loc: 'digha'
    },
    {
      text: 'এই উপকূলীয় অঞ্চলে মাছের উৎপাদন কেন কমে গেছে?',
      tag: '🇧🇩 উৎপাদন হ্রাসের বৈজ্ঞানিক কারণ',
      loc: 'digha'
    }
  ];

  // Initialize Web Speech API
  useEffect(() => {
    const SpeechRecognition = (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition;
    if (SpeechRecognition) {
      const recognition = new SpeechRecognition();
      recognition.continuous = false;
      recognition.interimResults = true;

      // Match language for speech recognition
      const langMap: Record<LanguageCode, string> = {
        en: 'en-IN',
        bn: 'bn-IN',
        hi: 'hi-IN',
        ta: 'ta-IN',
        or: 'or-IN',
        te: 'te-IN',
        ml: 'ml-IN',
        gu: 'gu-IN',
        mr: 'mr-IN',
        kn: 'kn-IN'
      };
      recognition.lang = langMap[language] || 'en-IN';

      recognition.onstart = () => {
        setIsListening(true);
        setSpeechError(null);
      };

      recognition.onresult = (event: any) => {
        let transcript = '';
        for (let i = event.resultIndex; i < event.results.length; ++i) {
          transcript += event.results[i][0].transcript;
        }
        setInputQuery(transcript);
      };

      recognition.onerror = (event: any) => {
        console.warn('Speech recognition error:', event.error);
        setIsListening(false);
        if (event.error === 'not-allowed') {
          setSpeechError('Microphone permission required.');
        } else {
          setSpeechError(`Voice input: ${event.error}`);
        }
      };

      recognition.onend = () => {
        setIsListening(false);
      };

      setRecognitionInstance(recognition);
    }
  }, [language]);

  const toggleListening = () => {
    if (!recognitionInstance) {
      setSpeechError('Speech recognition is not supported in this browser.');
      return;
    }

    if (isListening) {
      recognitionInstance.stop();
    } else {
      setSpeechError(null);
      try {
        recognitionInstance.start();
      } catch (e) {
        console.error('Failed to start speech recognition:', e);
      }
    }
  };

  const handleFormSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!inputQuery.trim() || isLoading) return;
    const detectedLang = detectQueryLanguage(inputQuery, language);
    onSearch(inputQuery, selectedLocation || undefined, selectedTime || undefined, detectedLang.language);
  };

  const handleSelectPreset = (promptText: string, locKey: string) => {
    setInputQuery(promptText);
    setSelectedLocation(locKey);
    const detectedLang = detectQueryLanguage(promptText, language);
    onSearch(promptText, locKey, undefined, detectedLang.language);
  };

  return (
    <div className="bg-slate-900/95 border border-slate-800 rounded-2xl p-4 sm:p-5 shadow-xl space-y-4">

      {/* Query Bar Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center space-x-2">
          <Sparkles className="h-4 w-4 text-cyan-400" />
          <h2 className="text-sm font-bold text-slate-100 uppercase tracking-wider font-mono">
            {dict.queryTitle}
          </h2>
        </div>
        <span className="text-[11px] text-slate-400 flex items-center gap-1 font-mono">
          <Radio className="h-3 w-3 text-emerald-400 animate-pulse" />
          <span>{dict.languageMode}</span>
        </span>
      </div>

      {/* Main Search Input Form */}
      <form onSubmit={handleFormSubmit} className="space-y-3">
        {/* Dynamic Indian Regional Script Identification Banner */}
        {detected.language !== 'en' && (
          <div className="flex items-center justify-between text-[11px] font-mono text-cyan-300 bg-cyan-950/70 border border-cyan-800/60 px-3 py-1.5 rounded-lg shadow-sm">
            <span className="flex items-center gap-1.5">
              <Sparkles className="h-3.5 w-3.5 text-cyan-300 animate-pulse" />
              <span>Script Identified: <strong className="text-white">{detected.nativeName} ({detected.name})</strong></span>
            </span>
            <span className="text-[10px] text-cyan-400/80 bg-cyan-900/50 px-1.5 py-0.5 rounded border border-cyan-700/50 font-semibold">
              Auto-Switching Response & Voice
            </span>
          </div>
        )}

        <div className="relative flex items-center">
          <div className="absolute left-3.5 text-slate-400 pointer-events-none">
            <Search className="h-4 w-4" />
          </div>

          <input
            id="marine-query-input"
            type="text"
            value={inputQuery}
            onChange={(e) => setInputQuery(e.target.value)}
            placeholder={dict.queryPlaceholder}
            disabled={isLoading}
            className="w-full bg-slate-950 border border-slate-700/80 rounded-xl pl-10 pr-24 py-3 text-sm text-slate-100 placeholder-slate-500 focus:outline-none focus:ring-2 focus:ring-cyan-500 focus:border-transparent transition-all shadow-inner"
          />

          {/* Voice Microphone & Submit Buttons */}
          <div className="absolute right-2 flex items-center space-x-1.5">
            <button
              id="btn-voice-input"
              type="button"
              onClick={toggleListening}
              title={isListening ? 'Stop listening' : 'Start voice input'}
              className={`p-2 rounded-lg transition-all ${isListening
                  ? 'bg-rose-500 text-white animate-pulse shadow-lg shadow-rose-500/50'
                  : 'bg-slate-800 hover:bg-slate-700 text-slate-300 hover:text-white'
                }`}
            >
              {isListening ? <MicOff className="h-4 w-4" /> : <Mic className="h-4 w-4" />}
            </button>

            <button
              id="btn-submit-query"
              type="submit"
              disabled={isLoading || !inputQuery.trim()}
              className="bg-gradient-to-r from-cyan-500 to-blue-600 hover:from-cyan-400 hover:to-blue-500 text-slate-950 font-bold px-3.5 py-2 rounded-lg text-xs transition-all flex items-center space-x-1 disabled:opacity-50 disabled:cursor-not-allowed shadow-md shadow-cyan-500/30"
            >
              {isLoading ? (
                <RefreshCw className="h-3.5 w-3.5 animate-spin" />
              ) : (
                <>
                  <span>{dict.run}</span>
                  <Send className="h-3 w-3" />
                </>
              )}
            </button>
          </div>
        </div>

        {/* Speech Listening Feedback or Error */}
        {isListening && (
          <div className="flex items-center space-x-2 text-xs text-rose-400 bg-rose-950/40 border border-rose-900/50 px-3 py-1.5 rounded-lg animate-pulse">
            <span className="h-2 w-2 rounded-full bg-rose-500"></span>
            <span>{dict.listening} Speak clearly in your selected language.</span>
          </div>
        )}
        {speechError && (
          <div className="text-xs text-amber-400 bg-amber-950/30 border border-amber-900/50 px-3 py-1 rounded-lg">
            {speechError}
          </div>
        )}

        {/* Optional Structured Filters (Location & Time Override) */}
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 pt-1">

          <div className="flex items-center space-x-2 bg-slate-950/70 border border-slate-800 rounded-lg px-2.5 py-1.5 text-xs text-slate-300">
            <MapPin className="h-3.5 w-3.5 text-cyan-400 shrink-0" />
            <select
              id="select-coastal-station"
              value={selectedLocation}
              onChange={(e) => setSelectedLocation(e.target.value)}
              className="bg-transparent text-slate-200 text-xs w-full cursor-pointer"
            >
              <option value="" className="bg-slate-900 text-slate-400">{dict.autoLocation}</option>
              {Object.entries(COASTAL_LOCATIONS).map(([key, loc]) => (
                <option key={key} value={key} className="bg-slate-900 text-slate-200">
                  {loc.name} ({loc.state})
                </option>
              ))}
            </select>
          </div>

          <div className="flex items-center space-x-2 bg-slate-950/70 border border-slate-800 rounded-lg px-2.5 py-1.5 text-xs text-slate-300">
            <Clock className="h-3.5 w-3.5 text-cyan-400 shrink-0" />
            <select
              id="select-time-window"
              value={selectedTime}
              onChange={(e) => setSelectedTime(e.target.value)}
              className="bg-transparent text-slate-200 text-xs w-full cursor-pointer"
            >
              <option value="" className="bg-slate-900 text-slate-400">{dict.autoTime}</option>
              <option value="current" className="bg-slate-900 text-slate-200">{dict.currentNextHours}</option>
              <option value="tomorrow morning" className="bg-slate-900 text-slate-200">{dict.tomorrowMorning}</option>
              <option value="tomorrow" className="bg-slate-900 text-slate-200">{dict.tomorrowFullDay}</option>
              <option value="weekend" className="bg-slate-900 text-slate-200">{dict.upcomingWeekend}</option>
            </select>
          </div>

        </div>

      </form>

      {/* Suggested Prompt Chips (Section 2C: Touch-Snap Carousel) */}
      <div className="space-y-1.5 pt-1">
        <div className="text-[11px] font-mono text-slate-400 flex items-center justify-between">
          <span>{dict.benchmarkScenarios}</span>
          <span className="text-[10px] text-cyan-400 font-mono flex items-center gap-1">
            <span>← Swipe →</span>
          </span>
        </div>
        <div className="horizontal-snap-carousel gap-2 py-1">
          {samplePrompts.map((p, idx) => (
            <button
              key={idx}
              id={`preset-btn-${idx}`}
              onClick={() => handleSelectPreset(p.text, p.loc)}
              className="px-3 py-2 rounded-xl bg-slate-950/80 hover:bg-slate-800 border border-slate-800 hover:border-cyan-500/50 text-slate-300 hover:text-cyan-300 text-xs font-medium transition-all text-left flex items-center space-x-2 shadow-sm btn-micro-interactive"
            >
              <span className="h-2 w-2 rounded-full bg-cyan-400 shrink-0"></span>
              <span className="whitespace-nowrap">{p.tag}</span>
            </button>
          ))}
        </div>
      </div>

    </div>
  );
};
