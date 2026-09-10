import React, { useState, useRef, useEffect } from 'react';
import {
  MessageSquare,
  X,
  Send,
  Mic,
  MicOff,
  RefreshCw,
  Sparkles,
  MapPin,
  Compass,
  AlertTriangle,
  ShieldCheck,
  ShieldAlert,
  Volume2,
  Trash2,
  ChevronRight,
  Clock,
  Layers,
  ArrowRight,
  Navigation
} from 'lucide-react';
import { ConversationTurn, LanguageCode, LocationInfo, OrcaAnalysisResponse } from '../types';
import { MULTILINGUAL_DICTIONARY } from '../data/coastalData';
import { detectQueryLanguage } from '../utils/languageDetector';
import { voiceWarning } from '../services/audio/voiceWarningService';

interface MarineChatDrawerProps {
  isOpen: boolean;
  onClose: () => void;
  sessionId: string;
  onNewSession: () => void;
  turns: ConversationTurn[];
  isLoading: boolean;
  onSendMessage: (query: string) => void;
  language: LanguageCode;
  onSelectLocation?: (locationKey: string) => void;
  onSelectTurnData?: (analysis: OrcaAnalysisResponse) => void;
}

export const MarineChatDrawer: React.FC<MarineChatDrawerProps> = ({
  isOpen,
  onClose,
  sessionId,
  onNewSession,
  turns,
  isLoading,
  onSendMessage,
  language,
  onSelectTurnData,
}) => {
  const [inputMessage, setInputMessage] = useState('');
  const [isListening, setIsListening] = useState(false);
  const [speakingTurnId, setSpeakingTurnId] = useState<string | null>(null);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const dict = MULTILINGUAL_DICTIONARY[language] || MULTILINGUAL_DICTIONARY.en;

  const scrollToBottom = () => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  };

  useEffect(() => {
    if (isOpen) {
      scrollToBottom();
    }
  }, [isOpen, turns]);

  // All 8 canonical ISRO Problem Statement 26176 scenario recommendations
  const scenarioSuggestions = [
    { label: 'Q1: Nearest PFZ Today', query: 'Where is the nearest Potential Fishing Zone today?' },
    { label: 'Q2: Venture Safety Tomorrow', query: 'Is it safe to venture into the sea tomorrow morning?' },
    { label: 'Q3: Tide & Sea Conditions', query: 'What are the tide, weather, and sea conditions near my fishing location?' },
    { label: 'Q4: Cyclone & Lightning Alerts', query: 'Are there any lightning or cyclone alerts in my area?' },
    { label: 'Q5: Chlorophyll & SST Fronts', query: 'Which regions show high chlorophyll concentration and favourable sea surface temperature?' },
    { label: 'Q6: Safest Navigation Route', query: 'What is the safest route for a fishing vessel considering weather and sea-state conditions?' },
    { label: 'Q7: Fish Productivity Decline', query: 'Why has fish productivity declined in a particular coastal region?' },
    { label: 'Q8: Restricted Geofence Zones', query: 'Which fishing zones should be avoided due to hazardous marine conditions or geofencing restrictions?' },
  ];

  const handleSend = (e?: React.FormEvent) => {
    if (e) e.preventDefault();
    const text = inputMessage.trim();
    if (!text || isLoading) return;
    setInputMessage('');
    onSendMessage(text);
  };

  const handleSuggestionClick = (queryText: string) => {
    if (isLoading) return;
    onSendMessage(queryText);
  };

  useEffect(() => {
    const unsub = voiceWarning.subscribe((isSpeaking) => {
      if (!isSpeaking) setSpeakingTurnId(null);
    });
    return () => {
      unsub();
    };
  }, []);

  const handleSpeakTurn = async (turn: ConversationTurn) => {
    if (speakingTurnId === turn.turnId) {
      voiceWarning.cancel();
      setSpeakingTurnId(null);
      return;
    }
    setSpeakingTurnId(turn.turnId);
    try {
      await voiceWarning.speak(turn.responseSummary, turn.language, {
        force: true,
      });
    } finally {
      setSpeakingTurnId(null);
    }
  };

  // Web Speech API integration
  const toggleSpeechRecognition = () => {
    const SpeechRecognition = (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition;
    if (!SpeechRecognition) {
      alert('Speech recognition is not supported in this browser.');
      return;
    }

    if (isListening) {
      setIsListening(false);
      return;
    }

    try {
      const recognition = new SpeechRecognition();
      recognition.continuous = false;
      recognition.interimResults = true;

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
        kn: 'kn-IN',
      };
      recognition.lang = langMap[language] || 'en-IN';

      recognition.onstart = () => setIsListening(true);
      recognition.onresult = (event: any) => {
        let transcript = '';
        for (let i = event.resultIndex; i < event.results.length; ++i) {
          transcript += event.results[i][0].transcript;
        }
        setInputMessage(transcript);
      };
      recognition.onerror = () => setIsListening(false);
      recognition.onend = () => setIsListening(false);
      recognition.start();
    } catch {
      setIsListening(false);
    }
  };

  if (!isOpen) return null;

  return (
    <div className="fixed inset-y-0 right-0 z-50 flex w-full max-w-lg flex-col bg-slate-950/95 text-slate-100 shadow-2xl backdrop-blur-xl border-l border-slate-800 transition-all sm:max-w-xl">
      {/* Header */}
      <div className="flex items-center justify-between border-b border-slate-800 px-5 py-4 bg-slate-900/80">
        <div className="flex items-center space-x-3">
          <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-cyan-500/20 text-cyan-400 border border-cyan-500/30">
            <MessageSquare className="h-5 w-5" />
          </div>
          <div>
            <div className="flex items-center space-x-2">
              <h2 className="text-sm font-bold uppercase tracking-wider font-mono text-white">
                Multi-Turn Marine Chat
              </h2>
              <span className="rounded bg-cyan-950 px-2 py-0.5 text-[10px] font-semibold text-cyan-300 border border-cyan-800">
                {turns.length} {turns.length === 1 ? 'Turn' : 'Turns'}
              </span>
            </div>
            <p className="text-[11px] text-slate-400 font-mono">
              Session Memory &amp; Scenario Reasoning
            </p>
          </div>
        </div>

        <div className="flex items-center space-x-2">
          <button
            onClick={onNewSession}
            title="Start new thread / clear memory"
            className="flex items-center gap-1 rounded-lg border border-slate-700 bg-slate-800/80 px-2.5 py-1.5 text-xs text-slate-300 hover:bg-slate-700 hover:text-white transition-all font-mono"
          >
            <Trash2 className="h-3.5 w-3.5 text-rose-400" />
            <span className="hidden sm:inline">New Thread</span>
          </button>
          <button
            onClick={onClose}
            className="rounded-lg p-1.5 text-slate-400 hover:bg-slate-800 hover:text-white transition-colors"
          >
            <X className="h-5 w-5" />
          </button>
        </div>
      </div>

      {/* Messages Scroll Area */}
      <div className="flex-1 overflow-y-auto px-4 py-4 space-y-4">
        {turns.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-full text-center px-4 py-12">
            <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-cyan-500/10 text-cyan-400 mb-3 border border-cyan-500/20">
              <Sparkles className="h-6 w-6" />
            </div>
            <h3 className="text-sm font-bold text-white mb-1">
              Contextual Marine Decision Support
            </h3>
            <p className="text-xs text-slate-400 max-w-sm mb-6">
              Ask any question in English or 9 Indian regional languages. The assistant retains your location, active fishing zones, and navigation constraints across conversation turns.
            </p>

            <div className="w-full space-y-2 text-left">
              <span className="text-[11px] font-mono text-slate-400 uppercase tracking-wider">
                Suggested Initial Inquiries:
              </span>
              {scenarioSuggestions.slice(0, 4).map((s, idx) => (
                <button
                  key={idx}
                  onClick={() => handleSuggestionClick(s.query)}
                  className="w-full text-left rounded-xl border border-slate-800 bg-slate-900/60 p-2.5 text-xs text-slate-200 hover:bg-slate-800 hover:border-cyan-500/40 transition-all flex items-center justify-between group"
                >
                  <span>{s.label}</span>
                  <ChevronRight className="h-3.5 w-3.5 text-slate-500 group-hover:text-cyan-400 group-hover:translate-x-0.5 transition-all" />
                </button>
              ))}
            </div>
          </div>
        ) : (
          turns.map((turn, index) => {
            const analysis = turn.responseAnalysis;
            const decision = analysis?.operationalDecision?.decision;
            const riskLevel = analysis?.risk?.riskLevel;

            return (
              <div key={turn.turnId} className="space-y-3">
                {/* User Message Bubble */}
                <div className="flex justify-end">
                  <div className="max-w-[85%] rounded-2xl bg-cyan-600 px-4 py-2.5 text-xs font-medium text-white shadow-md shadow-cyan-950/40">
                    <p className="leading-relaxed">{turn.query}</p>
                    <div className="mt-1 flex items-center justify-end gap-1.5 text-[9px] text-cyan-200 font-mono opacity-80">
                      <span>Turn #{index + 1}</span>
                      <span>•</span>
                      <span>{new Date(turn.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</span>
                    </div>
                  </div>
                </div>

                {/* ORCA Agent Response Card */}
                <div className="flex justify-start">
                  <div className="max-w-[95%] rounded-2xl border border-slate-800 bg-slate-900/90 p-4 shadow-xl space-y-3">
                    {/* Status Header */}
                    <div className="flex items-center justify-between gap-2 border-b border-slate-800/80 pb-2">
                      <div className="flex items-center space-x-1.5">
                        <span className="flex h-2 w-2 rounded-full bg-cyan-400" />
                        <span className="font-mono text-[10px] uppercase font-bold text-cyan-400 tracking-wider">
                          ORCA-X Agent
                        </span>
                        {turn.locationName && (
                          <span className="rounded bg-slate-800 px-1.5 py-0.5 text-[10px] text-slate-300 font-mono">
                            {turn.locationName.split(' ')[0]}
                          </span>
                        )}
                      </div>

                      <div className="flex items-center space-x-1.5">
                        {decision && (
                          <span
                            className={`rounded px-2 py-0.5 text-[10px] font-black uppercase font-mono ${
                              decision === 'PROCEED'
                                ? 'bg-emerald-950 text-emerald-400 border border-emerald-800'
                                : decision === 'CAUTION'
                                ? 'bg-amber-950 text-amber-400 border border-amber-800'
                                : 'bg-rose-950 text-rose-400 border border-rose-800'
                            }`}
                          >
                            {decision}
                          </span>
                        )}
                        <button
                          onClick={() => handleSpeakTurn(turn)}
                          title="Read out response"
                          className={`rounded-md p-1 transition-colors ${
                            speakingTurnId === turn.turnId
                              ? 'bg-cyan-500 text-slate-950'
                              : 'text-slate-400 hover:bg-slate-800 hover:text-white'
                          }`}
                        >
                          <Volume2 className="h-3.5 w-3.5" />
                        </button>
                      </div>
                    </div>

                    {/* Briefing Text */}
                    <div className="text-xs text-slate-200 leading-relaxed space-y-1 whitespace-pre-line font-sans">
                      {turn.responseSummary}
                    </div>

                    {/* Quick Metrics Bar */}
                    {analysis && (
                      <div className="grid grid-cols-3 gap-1.5 pt-1 text-center font-mono">
                        <div className="rounded-lg bg-slate-950/70 border border-slate-800/70 p-1.5">
                          <span className="text-[9px] text-slate-400 block">Waves</span>
                          <span className="text-xs font-bold text-white">
                            {analysis.ocean?.waveHeightMeters?.toFixed(1) ?? 'N/A'}m
                          </span>
                        </div>
                        <div className="rounded-lg bg-slate-950/70 border border-slate-800/70 p-1.5">
                          <span className="text-[9px] text-slate-400 block">Wind</span>
                          <span className="text-xs font-bold text-white">
                            {analysis.weather?.windSpeedKts?.toFixed(0) ?? 'N/A'} kt
                          </span>
                        </div>
                        <div className="rounded-lg bg-slate-950/70 border border-slate-800/70 p-1.5">
                          <span className="text-[9px] text-slate-400 block">Risk</span>
                          <span
                            className={`text-xs font-bold ${
                              riskLevel === 'LOW'
                                ? 'text-emerald-400'
                                : riskLevel === 'MODERATE'
                                ? 'text-amber-400'
                                : 'text-rose-400'
                            }`}
                          >
                            {analysis.risk?.riskScore ?? 'N/A'}/100
                          </span>
                        </div>
                      </div>
                    )}

                    {/* Safe Route Quick Indicator */}
                    {analysis?.safeRoute?.status === 'ROUTE_FOUND' && (
                      <div className="flex items-center justify-between p-2 rounded-xl bg-emerald-950/40 border border-emerald-800/60 font-mono text-[11px]">
                        <div className="flex items-center gap-1.5 text-emerald-300 font-bold truncate">
                          <Navigation className="h-3.5 w-3.5 text-emerald-400 shrink-0" />
                          <span className="truncate">
                            Passage: {((analysis.safeRoute.distanceKm || 0) / 1.852).toFixed(1)} NM ({analysis.safeRoute.distanceKm} km)
                          </span>
                        </div>
                        <button
                          onClick={() => {
                            if (onSelectTurnData) onSelectTurnData(analysis);
                            if (analysis.safeRoute?.destination && (window as any).__orcaPlotRouteTo) {
                              (window as any).__orcaPlotRouteTo(
                                analysis.safeRoute.destination.latitude,
                                analysis.safeRoute.destination.longitude,
                                analysis.safeRoute.destinationLabel || 'Safe Target'
                              );
                            }
                          }}
                          className="px-2 py-1 bg-emerald-600 hover:bg-emerald-500 text-white font-bold rounded-lg text-[10px] transition-all flex items-center gap-1 shadow cursor-pointer shrink-0"
                        >
                          View on Map
                        </button>
                      </div>
                    )}

                    {/* Action Links */}
                    {analysis && onSelectTurnData && (
                      <div className="flex items-center justify-between pt-1 text-[11px] border-t border-slate-800/60 font-mono">
                        <button
                          onClick={() => onSelectTurnData(analysis)}
                          className="text-cyan-400 hover:text-cyan-300 flex items-center gap-1 font-semibold"
                        >
                          <Layers className="h-3.5 w-3.5" />
                          <span>Inspect on Live Map &amp; Telemetry</span>
                        </button>
                        <span className="text-[9px] text-slate-500">
                          {analysis.agentTraces?.length ?? 0} agents
                        </span>
                      </div>
                    )}
                  </div>
                </div>
              </div>
            );
          })
        )}
        <div ref={messagesEndRef} />
      </div>

      {/* Suggested Follow-up Scenarios Chips */}
      {turns.length > 0 && (
        <div className="border-t border-slate-800/80 bg-slate-950 px-3 py-2">
          <span className="text-[10px] font-mono text-slate-400 uppercase tracking-wider block mb-1.5">
            Suggested Scenario Follow-ups:
          </span>
          <div className="flex items-center space-x-1.5 overflow-x-auto pb-1 no-scrollbar">
            {scenarioSuggestions.map((s, idx) => (
              <button
                key={idx}
                onClick={() => handleSuggestionClick(s.query)}
                disabled={isLoading}
                className="shrink-0 rounded-full border border-slate-800 bg-slate-900/80 px-2.5 py-1 text-[11px] text-slate-300 hover:border-cyan-500/50 hover:bg-slate-800 hover:text-white transition-all disabled:opacity-50"
              >
                {s.label}
              </button>
            ))}
          </div>
        </div>
      )}

      {/* Message Input Bar */}
      <form onSubmit={handleSend} className="border-t border-slate-800 p-3 bg-slate-900/90">
        <div className="relative flex items-center">
          <input
            type="text"
            value={inputMessage}
            onChange={(e) => setInputMessage(e.target.value)}
            placeholder="Ask a follow-up (e.g. 'What about tomorrow morning?', 'Show safest route')..."
            disabled={isLoading}
            className="w-full rounded-xl border border-slate-700 bg-slate-950 py-2.5 pl-3.5 pr-20 text-xs text-white placeholder-slate-500 focus:border-cyan-500 focus:outline-none focus:ring-1 focus:ring-cyan-500"
          />

          <div className="absolute right-1.5 flex items-center space-x-1">
            <button
              type="button"
              onClick={toggleSpeechRecognition}
              title={isListening ? 'Stop listening' : 'Voice input'}
              className={`rounded-lg p-1.5 transition-all ${
                isListening
                  ? 'bg-rose-500 text-white'
                  : 'text-slate-400 hover:bg-slate-800 hover:text-white'
              }`}
            >
              {isListening ? <MicOff className="h-4 w-4" /> : <Mic className="h-4 w-4" />}
            </button>

            <button
              type="submit"
              disabled={isLoading || !inputMessage.trim()}
              className="rounded-lg bg-cyan-500 p-1.5 text-slate-950 hover:bg-cyan-400 disabled:opacity-40 transition-colors shadow"
            >
              {isLoading ? (
                <RefreshCw className="h-4 w-4 animate-spin" />
              ) : (
                <Send className="h-4 w-4" />
              )}
            </button>
          </div>
        </div>
      </form>
    </div>
  );
};
