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
  Radio,
  MessageSquare,
  CheckCircle2
} from 'lucide-react';
import { LanguageCode } from '../types';
import { MULTILINGUAL_DICTIONARY, COASTAL_LOCATIONS } from '../data/coastalData';
import { detectQueryLanguage } from '../utils/languageDetector';

interface QueryPanelProps {
  onSearch: (query: string, locationOverride?: string, timeOverride?: string, detectedLang?: LanguageCode) => void;
  isLoading: boolean;
  language: LanguageCode;
  onOpenChat?: () => void;
  sync?: { query: string; locationKey: string | null; nonce: number };
}

export const ISRO_BENCHMARK_QUERIES = [
  {
    id: 'Q1',
    short: 'Nearest PFZ Today',
    query: 'Where is the nearest Potential Fishing Zone (PFZ) today?',
    tag: '🐟 Q1: Nearest PFZ',
    category: 'PFZ Discovery'
  },
  {
    id: 'Q2',
    short: 'Venture Safety Tomorrow',
    query: 'Is it safe to venture into the sea tomorrow morning?',
    tag: '⚓ Q2: Venture Safety',
    category: 'Operational Risk'
  },
  {
    id: 'Q3',
    short: 'Tide, Weather & Sea State',
    query: 'What are the tide, weather, and sea conditions near my fishing location?',
    tag: '🌊 Q3: Sea & Tide State',
    category: 'Ocean & Weather'
  },
  {
    id: 'Q4',
    short: 'Lightning & Cyclone Alerts',
    query: 'Are there any lightning or cyclone alerts in my area?',
    tag: '⚡ Q4: Cyclone & Lightning',
    category: 'Proactive Alerts'
  },
  {
    id: 'Q5',
    short: 'Chlorophyll & SST Fronts',
    query: 'Which regions show high chlorophyll concentration and favourable sea surface temperature?',
    tag: '🛰️ Q5: Chlorophyll & SST',
    category: 'Earth Observation'
  },
  {
    id: 'Q6',
    short: 'Safest Navigation Route',
    query: 'What is the safest route for a fishing vessel considering weather and sea-state conditions?',
    tag: '🧭 Q6: Safe Routing',
    category: 'Navigation'
  },
  {
    id: 'Q7',
    short: 'Fish Productivity Decline',
    query: 'Why has fish productivity declined in a particular coastal region?',
    tag: '🔬 Q7: Productivity Decline',
    category: 'Scientific RAG'
  },
  {
    id: 'Q8',
    short: 'Avoidance & Geofencing',
    query: 'Which fishing zones should be avoided due to hazardous marine conditions or geofencing restrictions?',
    tag: '🛑 Q8: Geofence Avoidance',
    category: 'UNCLOS Geofence'
  }
];

export const QueryPanel: React.FC<QueryPanelProps> = ({
  onSearch,
  isLoading,
  language,
  onOpenChat,
  sync
}) => {
  const [inputQuery, setInputQuery] = useState<string>('Is it safe to fish near Digha tomorrow morning?');
  const [isListening, setIsListening] = useState<boolean>(false);
  const [speechError, setSpeechError] = useState<string | null>(null);
  const [recognitionInstance, setRecognitionInstance] = useState<any>(null);
  const [selectedLocation, setSelectedLocation] = useState<string>('');
  const [selectedTime, setSelectedTime] = useState<string>('');
  const [activePromptTab, setActivePromptTab] = useState<'isro' | 'regional'>('isro');

  const dict = MULTILINGUAL_DICTIONARY[language] || MULTILINGUAL_DICTIONARY.en;
  const detected = detectQueryLanguage(inputQuery, language);

  useEffect(() => {
    if (!sync) return;
    setInputQuery(sync.query);
    setSelectedLocation(sync.locationKey ?? '');
  }, [sync?.nonce]);

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
    <div className="bg-white border border-slate-200/90 rounded-2xl p-4 sm:p-5 shadow-sm space-y-4">

      {/* Query Bar Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center space-x-2">
          <Sparkles className="h-4 w-4 text-sky-600" />
          <h2 className="text-sm font-bold text-slate-900 uppercase tracking-wider font-mono">
            {dict.queryTitle}
          </h2>
        </div>
        <div className="flex items-center space-x-2">
          {onOpenChat && (
            <button
              type="button"
              onClick={onOpenChat}
              className="flex items-center space-x-1.5 bg-sky-50 hover:bg-sky-100 border border-sky-200 text-sky-800 text-xs px-2.5 py-1 rounded-xl transition-all shadow-2xs font-mono cursor-pointer font-medium"
              title="Open Multi-Turn Conversational Reasoning Drawer"
            >
              <MessageSquare className="h-3.5 w-3.5 text-sky-600" />
              <span>Multi-Turn Chat</span>
            </button>
          )}
          <span className="text-[11px] text-slate-500 flex items-center gap-1.5 font-mono">
            <Radio className="h-3 w-3 text-emerald-500 animate-pulse" />
            <span>{dict.languageMode}</span>
          </span>
        </div>
      </div>

      {/* Main Search Input Form */}
      <form onSubmit={handleFormSubmit} className="space-y-3">
        {/* Dynamic Indian Regional Script Identification Banner */}
        {detected.language !== 'en' && (
          <div className="flex items-center justify-between text-[11px] font-mono text-sky-800 bg-sky-50 border border-sky-200 px-3.5 py-1.5 rounded-xl shadow-2xs">
            <span className="flex items-center gap-1.5">
              <Sparkles className="h-3.5 w-3.5 text-sky-600 animate-pulse" />
              <span>Script Identified: <strong className="text-sky-950 font-bold">{detected.nativeName} ({detected.name})</strong></span>
            </span>
            <span className="text-[10px] text-sky-700 bg-sky-100 px-2 py-0.5 rounded-md border border-sky-200 font-semibold">
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
            className="w-full bg-slate-50 hover:bg-white focus:bg-white border border-slate-300 rounded-xl pl-10 pr-24 py-3 text-sm text-slate-900 placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-sky-400 focus:border-transparent transition-all shadow-xs"
          />

          {/* Voice Microphone & Submit Buttons */}
          <div className="absolute right-2 flex items-center space-x-1.5">
            <button
              id="btn-voice-input"
              type="button"
              onClick={toggleListening}
              title={isListening ? 'Stop listening' : 'Start voice input'}
              className={`p-2 rounded-lg transition-all cursor-pointer ${isListening
                ? 'bg-rose-500 text-white animate-pulse shadow-md shadow-rose-500/40'
                : 'bg-slate-100 hover:bg-slate-200 text-slate-600 hover:text-slate-900'
                }`}
            >
              {isListening ? <MicOff className="h-4 w-4" /> : <Mic className="h-4 w-4" />}
            </button>

            <button
              id="btn-submit-query"
              type="submit"
              disabled={isLoading || !inputQuery.trim()}
              className="bg-sky-600 hover:bg-sky-700 text-white font-bold px-3.5 py-2 rounded-lg text-xs transition-all flex items-center space-x-1.5 disabled:opacity-50 disabled:cursor-not-allowed shadow-sm shadow-sky-600/30 cursor-pointer"
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
          <div className="flex items-center space-x-2 text-xs text-rose-700 bg-rose-50 border border-rose-200 px-3 py-1.5 rounded-xl animate-pulse">
            <span className="h-2 w-2 rounded-full bg-rose-500"></span>
            <span>{dict.listening} Speak clearly in your selected language.</span>
          </div>
        )}
        {speechError && (
          <div className="text-xs text-amber-800 bg-amber-50 border border-amber-200 px-3 py-1.5 rounded-xl">
            {speechError}
          </div>
        )}

        {/* Optional Structured Filters (Location & Time Override) */}
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 pt-1">

          <div className="flex items-center space-x-2 bg-slate-50 border border-slate-200 rounded-xl px-3 py-1.5 text-xs text-slate-700">
            <MapPin className="h-3.5 w-3.5 text-sky-600 shrink-0" />
            <select
              id="select-coastal-station"
              value={selectedLocation}
              onChange={(e) => setSelectedLocation(e.target.value)}
              className="bg-transparent text-slate-800 text-xs w-full cursor-pointer focus:outline-none"
            >
              <option value="" className="bg-white text-slate-500">{dict.autoLocation}</option>
              {Object.entries(COASTAL_LOCATIONS).map(([key, loc]) => (
                <option key={key} value={key} className="bg-white text-slate-800">
                  {loc.name} ({loc.state})
                </option>
              ))}
            </select>
          </div>

          <div className="flex items-center space-x-2 bg-slate-50 border border-slate-200 rounded-xl px-3 py-1.5 text-xs text-slate-700">
            <Clock className="h-3.5 w-3.5 text-sky-600 shrink-0" />
            <select
              id="select-time-window"
              value={selectedTime}
              onChange={(e) => setSelectedTime(e.target.value)}
              className="bg-transparent text-slate-800 text-xs w-full cursor-pointer focus:outline-none"
            >
              <option value="" className="bg-white text-slate-500">{dict.autoTime}</option>
              <option value="current" className="bg-white text-slate-800">{dict.currentNextHours}</option>
              <option value="tomorrow morning" className="bg-white text-slate-800">{dict.tomorrowMorning}</option>
              <option value="tomorrow" className="bg-white text-slate-800">{dict.tomorrowFullDay}</option>
              <option value="weekend" className="bg-white text-slate-800">{dict.upcomingWeekend}</option>
            </select>
          </div>

        </div>

      </form>

      {/* Suggested Prompt Chips with Tabs */}
      <div className="space-y-2 pt-1">
        <div className="flex items-center justify-between border-b border-slate-200 pb-1.5">
          <div className="flex items-center space-x-1.5">
            <button
              type="button"
              onClick={() => setActivePromptTab('isro')}
              className={`text-[11px] font-mono font-bold px-3 py-1 rounded-xl transition-all flex items-center gap-1.5 cursor-pointer ${activePromptTab === 'isro'
                  ? 'bg-sky-600 text-white shadow-xs'
                  : 'text-slate-500 hover:text-slate-800 hover:bg-slate-100'
                }`}
            >
              <span>🚀 ISRO Benchmark Queries (1–8)</span>
            </button>
            <button
              type="button"
              onClick={() => setActivePromptTab('regional')}
              className={`text-[11px] font-mono font-bold px-3 py-1 rounded-xl transition-all flex items-center gap-1.5 cursor-pointer ${activePromptTab === 'regional'
                  ? 'bg-sky-600 text-white shadow-xs'
                  : 'text-slate-500 hover:text-slate-800 hover:bg-slate-100'
                }`}
            >
              <span>🇮🇳 Regional Scenarios</span>
            </button>
          </div>
          <span className="text-[10px] text-slate-400 font-mono hidden sm:inline-block">
            ← Scroll →
          </span>
        </div>

        {activePromptTab === 'isro' ? (
          <div className="custom-scrollbar gap-2 py-1.5 overflow-x-auto whitespace-nowrap">
            {ISRO_BENCHMARK_QUERIES.map((q) => (
              <button
                key={q.id}
                id={`isro-query-${q.id}`}
                onClick={() => handleSelectPreset(q.query, 'digha')}
                className="px-3 py-1.5 rounded-xl bg-slate-50 hover:bg-sky-50 border border-slate-200 hover:border-sky-300 text-slate-700 hover:text-sky-900 text-xs font-mono font-semibold transition-all flex items-center space-x-2 shrink-0 shadow-2xs cursor-pointer whitespace-nowrap active:scale-95"
                title={q.query}
              >
                <span className="text-[10px] font-mono font-bold text-sky-700 bg-sky-100 px-1.5 py-0.5 rounded-md border border-sky-200 shrink-0">
                  {q.id}
                </span>
                <span className="text-xs text-slate-800 font-semibold truncate max-w-[220px] sm:max-w-none">
                  {q.short}
                </span>
              </button>
            ))}
          </div>
        ) : (
          <div className="custom-scrollbar gap-2 py-1.5 overflow-x-auto whitespace-nowrap">
            {samplePrompts.map((p, idx) => (
              <button
                key={idx}
                id={`preset-btn-${idx}`}
                onClick={() => handleSelectPreset(p.text, p.loc)}
                className="px-3 py-1.5 rounded-xl bg-slate-50 hover:bg-sky-50 border border-slate-200 hover:border-sky-300 text-slate-700 hover:text-sky-900 text-xs font-mono font-semibold transition-all flex items-center space-x-2 shadow-2xs shrink-0 cursor-pointer whitespace-nowrap active:scale-95"
              >
                <span className="h-2 w-2 rounded-full bg-emerald-500 shrink-0"></span>
                <span>{p.tag}</span>
              </button>
            ))}
          </div>
        )}
      </div>

    </div>
  );
};
