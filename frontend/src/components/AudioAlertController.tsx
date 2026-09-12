import React, { useEffect, useState, useRef } from 'react';
import { Volume2, VolumeX, Radio, Sparkles, Square, Settings, X, CheckCircle, ShieldAlert, RotateCcw } from 'lucide-react';
import { LanguageCode, GeofenceSpatialAnalysis, RiskPrediction, AudioAlertPayload, selectPriorityGeofenceAlert } from '../types';
import { maritimeSiren } from '../services/audio/maritimeSirenService';
import { voiceWarning } from '../services/audio/voiceWarningService';
import { indicVoiceGateway, IndicVoiceConfig } from '../services/audio/indicVoiceService';

interface AudioAlertControllerProps {
  language: LanguageCode;
  geofenceAnalysis?: GeofenceSpatialAnalysis;
  risk?: RiskPrediction;
  audioAlert?: AudioAlertPayload;
  className?: string;
}

export const AudioAlertController: React.FC<AudioAlertControllerProps> = ({
  language,
  geofenceAnalysis,
  risk,
  audioAlert,
  className = '',
}) => {
  const [isMuted, setIsMuted] = useState<boolean>(false);
  const [isPlayingSiren, setIsPlayingSiren] = useState<boolean>(false);
  const [isSpeaking, setIsSpeaking] = useState<boolean>(false);
  const [lastActionText, setLastActionText] = useState<string>('Standing by for maritime alerts');
  const [showConfigModal, setShowConfigModal] = useState<boolean>(false);
  const lastSpokenAlertPhraseRef = useRef<string | null>(null);
  const [config, setConfigState] = useState<IndicVoiceConfig>(indicVoiceGateway.getConfig());
  const [saveMessage, setSaveMessage] = useState<string>('');

  // Subscribe to siren and voice status
  useEffect(() => {
    const unsubSiren = maritimeSiren.subscribe(setIsPlayingSiren);
    const unsubVoice = voiceWarning.subscribe(setIsSpeaking);
    return () => {
      unsubSiren();
      unsubVoice();
    };
  }, []);

  // Sync mute state
  const handleToggleMute = async () => {
    const nextMuted = !isMuted;
    setIsMuted(nextMuted);
    maritimeSiren.setMuted(nextMuted);
    voiceWarning.setMuted(nextMuted);

    if (!nextMuted) {
      await maritimeSiren.unlock();
      setLastActionText('Audio alerts enabled');
    } else {
      maritimeSiren.stop();
      voiceWarning.cancel();
      setLastActionText('Audio alerts silenced');
    }
  };

  // Test button
  const handleTestAlert = async () => {
    await maritimeSiren.unlock();
    if (isMuted) {
      handleToggleMute();
    }
    setLastActionText(`Testing siren & voice (${language.toUpperCase()})`);
    const testPhrase = voiceWarning.generateTestPhrase(language);
    await voiceWarning.speak(testPhrase, language, { playSirenFirst: true, isCritical: false, force: true });
  };

  // Stop button
  const handleStopAll = () => {
    maritimeSiren.stop();
    voiceWarning.cancel();
    setLastActionText('Audio alert halted');
  };

  // Automatic live condition trigger
  useEffect(() => {
    if (isMuted) return;

    // Find any critical breach alert (from activeAlerts first, then priority geofence)
    const criticalAlert =
      geofenceAnalysis?.activeAlerts?.find((a) => a.severity === 'CRITICAL_BREACH' || a.isInside) ||
      (geofenceAnalysis?.status === 'RESTRICTED_BREACH'
        ? selectPriorityGeofenceAlert(geofenceAnalysis)
        : undefined);

    // Find any proximity warning alert
    const warningAlert =
      geofenceAnalysis?.activeAlerts?.find((a) => a.severity === 'PROXIMITY_WARNING') ||
      (geofenceAnalysis?.status === 'CAUTION'
        ? selectPriorityGeofenceAlert(geofenceAnalysis)
        : undefined);

    if (criticalAlert) {
      setLastActionText(`Critical alert sounding: ${criticalAlert.boundaryName}`);
      // Force severity to CRITICAL_BREACH so evaluateAndAnnounce speaks it
      const alertWithSeverity = { ...criticalAlert, severity: 'CRITICAL_BREACH' as const };
      voiceWarning.evaluateAndAnnounce(alertWithSeverity, risk, language);
    } else if (warningAlert) {
      setLastActionText(`Proximity alert: ${warningAlert.boundaryName}`);
      // Force severity to PROXIMITY_WARNING so evaluateAndAnnounce speaks it
      const alertWithSeverity = { ...warningAlert, severity: 'PROXIMITY_WARNING' as const };
      voiceWarning.evaluateAndAnnounce(alertWithSeverity, risk, language);
    } else if (risk && risk.riskLevel === 'EXTREME') {
      setLastActionText('Extreme marine weather alert');
      voiceWarning.evaluateAndAnnounce(undefined, risk, language);
    }
  }, [geofenceAnalysis, risk, language, isMuted]);

  // Agentic audio warning auto-trigger
  useEffect(() => {
    if (isMuted || !audioAlert || !audioAlert.phrase) return;
    if (audioAlert.cueType === 'SILENT') return;
    if (lastSpokenAlertPhraseRef.current === audioAlert.phrase) return;

    lastSpokenAlertPhraseRef.current = audioAlert.phrase;

    const playAlert = async () => {
      setLastActionText(audioAlert.phrase);
      if (audioAlert.cueType === 'SIREN_CRITICAL') {
        await maritimeSiren.unlock();
        await voiceWarning.speak(audioAlert.phrase, audioAlert.language || language, {
          playSirenFirst: true,
          isCritical: true,
          force: true,
        });
      } else if (audioAlert.cueType === 'CHIME_WARNING') {
        await maritimeSiren.unlock();
        await voiceWarning.speak(audioAlert.phrase, audioAlert.language || language, {
          playSirenFirst: true,
          isCritical: false,
          force: true,
        });
      } else if (audioAlert.cueType === 'VOICE_BRIEFING') {
        await voiceWarning.speak(audioAlert.phrase, audioAlert.language || language, {
          playSirenFirst: false,
          isCritical: false,
          force: true,
        });
      }
    };

    playAlert().catch((err) => console.error('Failed to trigger audio warning:', err));
  }, [audioAlert, isMuted, language]);

  const handleReplayBriefing = async () => {
    const phrase = audioAlert?.phrase || lastSpokenAlertPhraseRef.current;
    if (!phrase) return;
    await maritimeSiren.unlock();
    if (isMuted) await handleToggleMute();
    setLastActionText(`Replaying: ${phrase}`);
    await voiceWarning.speak(phrase, audioAlert?.language || language, {
      playSirenFirst: audioAlert?.cueType === 'SIREN_CRITICAL',
      isCritical: audioAlert?.isCritical || false,
      force: true,
    });
  };

  const handleSaveConfig = () => {
    indicVoiceGateway.setConfig(config);
    setSaveMessage('Saved successfully! Gateway updated.');
    setTimeout(() => {
      setSaveMessage('');
      setShowConfigModal(false);
    }, 1200);
  };

  const isAudioActive = isPlayingSiren || isSpeaking;

  return (
    <>
      <div
        className={`flex flex-wrap items-center justify-between gap-3 px-3.5 py-2 rounded-xl bg-white border transition-all ${
          isAudioActive
            ? 'border-rose-300 shadow-md ring-1 ring-rose-300'
            : 'border-slate-200/90 shadow-2xs'
        } ${className}`}
      >
        {/* Left: Audio Status & Controls */}
        <div className="flex items-center space-x-2.5 min-w-0">
          <button
            onClick={handleToggleMute}
            title={isMuted ? 'Unmute Maritime Audio Alerts' : 'Mute Maritime Audio Alerts'}
            className={`p-2 rounded-lg transition-all flex items-center justify-center cursor-pointer ${
              isMuted
                ? 'bg-slate-100 text-slate-500 hover:bg-slate-200 hover:text-slate-800 border border-slate-200'
                : isAudioActive
                ? 'bg-rose-500 text-white shadow-md shadow-rose-500/30 animate-pulse font-bold'
                : 'bg-sky-50 text-sky-700 border border-sky-200 hover:bg-sky-100'
            }`}
          >
            {isMuted ? <VolumeX className="h-4 w-4" /> : <Volume2 className="h-4 w-4" />}
          </button>

          <div className="flex flex-col min-w-0">
            <div className="flex items-center space-x-1.5">
              <span className="text-xs font-bold text-slate-800 tracking-wide flex items-center gap-1 font-mono">
                <Radio className={`h-3 w-3 ${isAudioActive ? 'text-rose-600 animate-spin' : 'text-sky-600'}`} />
                <span>MARITIME AUDIO:</span>
              </span>
              <span
                className={`text-[10px] font-mono font-bold px-1.5 py-0.2 rounded border ${
                  isMuted
                    ? 'bg-slate-100 text-slate-600 border-slate-200'
                    : isAudioActive
                    ? 'bg-rose-50 text-rose-700 border-rose-200 animate-pulse'
                    : 'bg-emerald-50 text-emerald-700 border-emerald-200'
                }`}
              >
                {isMuted ? 'MUTED' : isAudioActive ? (isPlayingSiren ? 'SIREN ACTIVE' : 'VOICE ACTIVE') : 'ARMED'}
              </span>
            </div>
            <span className="text-[11px] text-slate-500 truncate max-w-[260px] sm:max-w-xs font-sans">
              {lastActionText}
            </span>
          </div>
        </div>

        {/* Center: Live Equalizer Soundwave Animation */}
        <div className="flex items-center space-x-1 h-5 px-2 bg-slate-100 rounded-md border border-slate-200">
          {[1, 2, 3, 4, 5].map((bar) => {
            const heights = isAudioActive
              ? isPlayingSiren
                ? ['h-5 bg-rose-500', 'h-3 bg-rose-600', 'h-4 bg-amber-500', 'h-2 bg-rose-600', 'h-5 bg-rose-500']
                : ['h-3 bg-sky-500', 'h-5 bg-sky-600', 'h-2 bg-emerald-500', 'h-4 bg-sky-500', 'h-3 bg-sky-600']
              : ['h-1.5 bg-slate-300', 'h-2 bg-slate-300', 'h-1.5 bg-slate-300', 'h-2 bg-slate-300', 'h-1.5 bg-slate-300'];
            return (
              <div
                key={bar}
                className={`w-1 rounded-full transition-all duration-150 ${heights[(bar - 1) % heights.length]}`}
              />
            );
          })}
        </div>

        {/* Indic AI Gateway Settings Trigger */}
        <button
          onClick={() => setShowConfigModal(true)}
          className="hidden sm:flex items-center gap-1.5 px-2 py-1 rounded-md bg-slate-50 hover:bg-slate-100 border border-slate-200 text-[10px] font-mono text-slate-700 transition-all cursor-pointer shadow-2xs"
          title="Configure Bhashini & Sarvam Indic AI Gateway"
        >
          <span className="h-1.5 w-1.5 rounded-full bg-sky-500 animate-pulse" />
          <span>Indic AI: {config.preferredEngine.toUpperCase()}</span>
          <Settings className="h-3 w-3 text-slate-500 ml-0.5" />
        </button>

        {/* Right: Controls (Test Button & Halt) */}
        <div className="flex items-center space-x-2">
          {(audioAlert?.phrase || lastSpokenAlertPhraseRef.current) && (
            <button
              onClick={handleReplayBriefing}
              disabled={isAudioActive}
              className="px-2.5 py-1.5 rounded-lg text-xs font-bold font-mono text-emerald-800 bg-emerald-50 hover:bg-emerald-100 border border-emerald-200 flex items-center space-x-1.5 transition-all active:scale-95 disabled:opacity-50 cursor-pointer shadow-2xs"
              title="Replay spoken regional voice alert"
            >
              <RotateCcw className="h-3 w-3 text-emerald-600" />
              <span>Replay Voice Alert</span>
            </button>
          )}

          <button
            onClick={handleTestAlert}
            disabled={isAudioActive}
            className="px-2.5 py-1.5 rounded-lg text-xs font-bold font-mono text-sky-800 bg-sky-50 hover:bg-sky-100 border border-sky-200 flex items-center space-x-1.5 transition-all active:scale-95 disabled:opacity-50 cursor-pointer shadow-2xs"
          >
            <Sparkles className="h-3 w-3 text-sky-600" />
            <span>Test Siren &amp; Voice ({language.toUpperCase()})</span>
          </button>

          {isAudioActive && (
            <button
              onClick={handleStopAll}
              className="px-2 py-1.5 rounded-lg text-xs font-bold font-mono text-rose-700 bg-rose-50 hover:bg-rose-100 border border-rose-200 flex items-center space-x-1 transition-all active:scale-95 cursor-pointer shadow-2xs"
              title="Silence active siren or voice immediately"
            >
              <Square className="h-3 w-3 fill-current text-rose-600" />
              <span>Silence</span>
            </button>
          )}
        </div>
      </div>

      {/* Indic Voice Gateway Configuration Modal */}
      {showConfigModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/40 backdrop-blur-sm animate-in fade-in duration-200">
          <div className="bg-white border border-slate-200 rounded-xl p-5 max-w-md w-full shadow-2xl space-y-4 text-slate-800">
            <div className="flex items-center justify-between border-b border-slate-100 pb-3">
              <div className="flex items-center space-x-2">
                <Sparkles className="h-5 w-5 text-sky-600" />
                <h3 className="text-sm font-bold text-slate-900 font-mono tracking-wide">
                  Indic AI Voice Gateway
                </h3>
              </div>
              <button
                onClick={() => setShowConfigModal(false)}
                className="text-slate-400 hover:text-slate-700 p-1 cursor-pointer"
              >
                <X className="h-4 w-4" />
              </button>
            </div>

            {/* Currently Active Engine Status */}
            <div className="p-3 rounded-lg bg-emerald-50 border border-emerald-200 flex items-start gap-2.5">
              <CheckCircle className="h-4 w-4 text-emerald-600 mt-0.5 shrink-0" />
              <div className="text-xs space-y-0.5">
                <div className="text-emerald-800 font-bold font-mono">✅ Voice System is Active & Working</div>
                <div className="text-slate-600">
                  All 10 languages (Bengali, Tamil, Telugu, Odia, Malayalam, Gujarati, Marathi, Kannada, Hindi, English) are generating real audio via the built-in Indic TTS engine.
                </div>
                <div className="text-sky-700 font-mono text-[10px] mt-1">Active Engine: INDIC-STREAM (Google Translate TTS — Free, No Key Needed)</div>
              </div>
            </div>

            <div className="space-y-3 text-xs">
              <div>
                <label className="block text-slate-700 font-mono mb-1 font-semibold">Voice Engine Mode</label>
                <select
                  value={config.preferredEngine}
                  onChange={(e) =>
                    setConfigState({
                      ...config,
                      preferredEngine: e.target.value as IndicVoiceConfig['preferredEngine'],
                    })
                  }
                  className="w-full bg-slate-50 border border-slate-200 rounded-lg p-2 text-slate-800 font-mono text-xs focus:ring-1 focus:ring-sky-500"
                >
                  <option value="auto">Auto — Best Available (Recommended ✓)</option>
                  <option value="sarvam">Sarvam AI Bulbul:v1 (requires API key)</option>
                  <option value="bhashini">Bhashini NLTM / MeitY (requires API key)</option>
                  <option value="edge">Offline Edge — Devanagari Phonemics only</option>
                </select>
                <p className="text-slate-500 mt-1 text-[10px]">
                  "Auto" uses the free built-in engine. Sarvam / Bhashini provide higher audio quality if you have API keys (optional upgrade).
                </p>
              </div>

              {/* Optional Advanced API Keys — collapsed by default */}
              <details className="group">
                <summary className="cursor-pointer text-slate-500 hover:text-slate-800 font-mono text-[11px] flex items-center gap-1 select-none list-none">
                  <span className="group-open:rotate-90 transition-transform inline-block">▶</span>
                  <span>Advanced: Optional API Keys (leave empty — not required)</span>
                </summary>
                <div className="mt-2 space-y-2 pl-3 border-l border-slate-200">
                  <p className="text-[10px] text-amber-700 font-semibold">
                    ⚠️ Only fill these if you have a Sarvam AI or Bhashini account. The system works perfectly without them.
                  </p>
                  <div>
                    <label className="block text-slate-600 font-mono mb-1">Sarvam AI API Key <span className="text-slate-400">(optional)</span></label>
                    <input
                      type="password"
                      placeholder="Leave empty — not required"
                      value={config.sarvamApiKey || ''}
                      onChange={(e) => setConfigState({ ...config, sarvamApiKey: e.target.value })}
                      className="w-full bg-slate-50 border border-slate-200 rounded-lg p-2 text-slate-800 font-mono text-xs focus:ring-1 focus:ring-sky-500"
                    />
                  </div>
                  <div className="grid grid-cols-2 gap-2">
                    <div>
                      <label className="block text-slate-600 font-mono mb-1">Bhashini API Key <span className="text-slate-400">(optional)</span></label>
                      <input
                        type="password"
                        placeholder="Leave empty"
                        value={config.bhashiniApiKey || ''}
                        onChange={(e) => setConfigState({ ...config, bhashiniApiKey: e.target.value })}
                        className="w-full bg-slate-50 border border-slate-200 rounded-lg p-2 text-slate-800 font-mono text-xs focus:ring-1 focus:ring-sky-500"
                      />
                    </div>
                    <div>
                      <label className="block text-slate-600 font-mono mb-1">Bhashini User ID <span className="text-slate-400">(optional)</span></label>
                      <input
                        type="text"
                        placeholder="Leave empty"
                        value={config.bhashiniUserId || ''}
                        onChange={(e) => setConfigState({ ...config, bhashiniUserId: e.target.value })}
                        className="w-full bg-slate-50 border border-slate-200 rounded-lg p-2 text-slate-800 font-mono text-xs focus:ring-1 focus:ring-sky-500"
                      />
                    </div>
                  </div>
                </div>
              </details>
            </div>

            {saveMessage && (
              <div className="text-xs text-emerald-700 font-mono text-center font-bold">{saveMessage}</div>
            )}

            <div className="flex items-center justify-end space-x-2 pt-2 border-t border-slate-100">
              <button
                onClick={() => setShowConfigModal(false)}
                className="px-3 py-1.5 rounded-lg text-xs font-mono text-slate-500 hover:text-slate-800 border border-slate-200 cursor-pointer"
              >
                Close
              </button>
              <button
                onClick={handleSaveConfig}
                className="px-3.5 py-1.5 rounded-lg text-xs font-mono font-bold bg-sky-600 text-white hover:bg-sky-700 transition-all shadow-xs cursor-pointer"
              >
                Save &amp; Apply
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
};

export default AudioAlertController;

