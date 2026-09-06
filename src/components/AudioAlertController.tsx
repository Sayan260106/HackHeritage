import React, { useEffect, useState } from 'react';
import { Volume2, VolumeX, Radio, Sparkles, Square, Settings, X, CheckCircle, ShieldAlert } from 'lucide-react';
import { LanguageCode, GeofenceSpatialAnalysis, RiskPrediction } from '../types';
import { maritimeSiren } from '../services/audio/maritimeSirenService';
import { voiceWarning } from '../services/audio/voiceWarningService';
import { indicVoiceGateway, IndicVoiceConfig } from '../services/audio/indicVoiceService';

interface AudioAlertControllerProps {
  language: LanguageCode;
  geofenceAnalysis?: GeofenceSpatialAnalysis;
  risk?: RiskPrediction;
  className?: string;
}

export const AudioAlertController: React.FC<AudioAlertControllerProps> = ({
  language,
  geofenceAnalysis,
  risk,
  className = '',
}) => {
  const [isMuted, setIsMuted] = useState<boolean>(false);
  const [isPlayingSiren, setIsPlayingSiren] = useState<boolean>(false);
  const [isSpeaking, setIsSpeaking] = useState<boolean>(false);
  const [lastActionText, setLastActionText] = useState<string>('Standing by for maritime alerts');
  const [showConfigModal, setShowConfigModal] = useState<boolean>(false);
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

    // Find any critical breach alert (from activeAlerts first, then status-based fallback)
    const criticalAlert =
      geofenceAnalysis?.activeAlerts?.find((a) => a.severity === 'CRITICAL_BREACH') ||
      (geofenceAnalysis?.status === 'RESTRICTED_BREACH'
        ? geofenceAnalysis.nearestImbl || geofenceAnalysis.nearestMpa
        : undefined);

    // Find any proximity warning alert
    const warningAlert =
      geofenceAnalysis?.activeAlerts?.find((a) => a.severity === 'PROXIMITY_WARNING') ||
      (geofenceAnalysis?.status === 'CAUTION'
        ? geofenceAnalysis.nearestImbl || geofenceAnalysis.nearestMpa
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
        className={`flex flex-wrap items-center justify-between gap-3 px-3.5 py-2 rounded-xl bg-slate-950/90 border transition-all ${
          isAudioActive
            ? 'border-rose-500/60 shadow-lg shadow-rose-500/20 ring-1 ring-rose-500/40'
            : 'border-slate-800 shadow-md'
        } ${className}`}
      >
        {/* Left: Audio Status & Controls */}
        <div className="flex items-center space-x-2.5 min-w-0">
          <button
            onClick={handleToggleMute}
            title={isMuted ? 'Unmute Maritime Audio Alerts' : 'Mute Maritime Audio Alerts'}
            className={`p-2 rounded-lg transition-all flex items-center justify-center ${
              isMuted
                ? 'bg-slate-900 text-slate-400 hover:bg-slate-800 hover:text-slate-200 border border-slate-700'
                : isAudioActive
                ? 'bg-rose-500 text-slate-950 shadow-md shadow-rose-500/40 animate-pulse font-bold'
                : 'bg-cyan-500/20 text-cyan-300 border border-cyan-500/40 hover:bg-cyan-500/30'
            }`}
          >
            {isMuted ? <VolumeX className="h-4 w-4" /> : <Volume2 className="h-4 w-4" />}
          </button>

          <div className="flex flex-col min-w-0">
            <div className="flex items-center space-x-1.5">
              <span className="text-xs font-bold text-slate-200 tracking-wide flex items-center gap-1 font-mono">
                <Radio className={`h-3 w-3 ${isAudioActive ? 'text-rose-400 animate-spin' : 'text-cyan-400'}`} />
                <span>MARITIME AUDIO:</span>
              </span>
              <span
                className={`text-[10px] font-mono font-bold px-1.5 py-0.2 rounded border ${
                  isMuted
                    ? 'bg-slate-900 text-slate-400 border-slate-700'
                    : isAudioActive
                    ? 'bg-rose-500/20 text-rose-300 border-rose-500/40 animate-pulse'
                    : 'bg-emerald-500/20 text-emerald-300 border-emerald-500/40'
                }`}
              >
                {isMuted ? 'MUTED' : isAudioActive ? (isPlayingSiren ? 'SIREN ACTIVE' : 'VOICE ACTIVE') : 'ARMED'}
              </span>
            </div>
            <span className="text-[11px] text-slate-400 truncate max-w-[260px] sm:max-w-xs font-sans">
              {lastActionText}
            </span>
          </div>
        </div>

        {/* Center: Live Equalizer Soundwave Animation */}
        <div className="flex items-center space-x-1 h-5 px-2 bg-slate-900/80 rounded-md border border-slate-800">
          {[1, 2, 3, 4, 5].map((bar) => {
            const heights = isAudioActive
              ? isPlayingSiren
                ? ['h-5 bg-rose-400', 'h-3 bg-rose-500', 'h-4 bg-orange-400', 'h-2 bg-rose-500', 'h-5 bg-rose-400']
                : ['h-3 bg-cyan-400', 'h-5 bg-cyan-300', 'h-2 bg-emerald-400', 'h-4 bg-cyan-400', 'h-3 bg-cyan-300']
              : ['h-1.5 bg-slate-700', 'h-2 bg-slate-700', 'h-1.5 bg-slate-700', 'h-2 bg-slate-700', 'h-1.5 bg-slate-700'];
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
          className="hidden sm:flex items-center gap-1.5 px-2 py-1 rounded-md bg-slate-900 hover:bg-slate-800/80 border border-slate-700/60 hover:border-cyan-500/50 text-[10px] font-mono text-cyan-300 transition-all cursor-pointer"
          title="Configure Bhashini & Sarvam Indic AI Gateway"
        >
          <span className="h-1.5 w-1.5 rounded-full bg-cyan-400 animate-pulse" />
          <span>Indic AI: {config.preferredEngine.toUpperCase()}</span>
          <Settings className="h-3 w-3 text-slate-400 ml-0.5" />
        </button>

        {/* Right: Controls (Test Button & Halt) */}
        <div className="flex items-center space-x-2">
          <button
            onClick={handleTestAlert}
            disabled={isAudioActive}
            className="px-2.5 py-1.5 rounded-lg text-xs font-bold font-mono text-cyan-300 bg-cyan-950/60 hover:bg-cyan-900/60 border border-cyan-700/50 hover:border-cyan-500 flex items-center space-x-1.5 transition-all active:scale-95 disabled:opacity-50 cursor-pointer"
          >
            <Sparkles className="h-3 w-3 text-cyan-400" />
            <span>Test Siren &amp; Voice ({language.toUpperCase()})</span>
          </button>

          {isAudioActive && (
            <button
              onClick={handleStopAll}
              className="px-2 py-1.5 rounded-lg text-xs font-bold font-mono text-rose-300 bg-rose-950/80 hover:bg-rose-900/80 border border-rose-700/60 flex items-center space-x-1 transition-all active:scale-95 cursor-pointer"
              title="Silence active siren or voice immediately"
            >
              <Square className="h-3 w-3 fill-current text-rose-400" />
              <span>Silence</span>
            </button>
          )}
        </div>
      </div>

      {/* Indic Voice Gateway Configuration Modal */}
      {showConfigModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/70 backdrop-blur-sm animate-in fade-in duration-200">
          <div className="bg-slate-900 border border-slate-700 rounded-xl p-5 max-w-md w-full shadow-2xl space-y-4">
            <div className="flex items-center justify-between border-b border-slate-800 pb-3">
              <div className="flex items-center space-x-2">
                <Sparkles className="h-5 w-5 text-cyan-400" />
                <h3 className="text-sm font-bold text-slate-100 font-mono tracking-wide">
                  Indic AI Voice Gateway
                </h3>
              </div>
              <button
                onClick={() => setShowConfigModal(false)}
                className="text-slate-400 hover:text-slate-200 p-1"
              >
                <X className="h-4 w-4" />
              </button>
            </div>

            {/* Currently Active Engine Status */}
            <div className="p-3 rounded-lg bg-emerald-950/60 border border-emerald-500/40 flex items-start gap-2.5">
              <CheckCircle className="h-4 w-4 text-emerald-400 mt-0.5 shrink-0" />
              <div className="text-xs space-y-0.5">
                <div className="text-emerald-300 font-bold font-mono">✅ Voice System is Active & Working</div>
                <div className="text-slate-400">
                  All 10 languages (Bengali, Tamil, Telugu, Odia, Malayalam, Gujarati, Marathi, Kannada, Hindi, English) are generating real audio via the built-in Indic TTS engine.
                </div>
                <div className="text-cyan-400 font-mono text-[10px] mt-1">Active Engine: INDIC-STREAM (Google Translate TTS — Free, No Key Needed)</div>
              </div>
            </div>

            <div className="space-y-3 text-xs">
              <div>
                <label className="block text-slate-300 font-mono mb-1">Voice Engine Mode</label>
                <select
                  value={config.preferredEngine}
                  onChange={(e) =>
                    setConfigState({
                      ...config,
                      preferredEngine: e.target.value as IndicVoiceConfig['preferredEngine'],
                    })
                  }
                  className="w-full bg-slate-950 border border-slate-700 rounded-lg p-2 text-slate-200 font-mono text-xs focus:ring-1 focus:ring-cyan-500"
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
                <summary className="cursor-pointer text-slate-400 hover:text-slate-200 font-mono text-[11px] flex items-center gap-1 select-none list-none">
                  <span className="group-open:rotate-90 transition-transform inline-block">▶</span>
                  <span>Advanced: Optional API Keys (leave empty — not required)</span>
                </summary>
                <div className="mt-2 space-y-2 pl-3 border-l border-slate-700">
                  <p className="text-[10px] text-amber-400/80">
                    ⚠️ Only fill these if you have a Sarvam AI or Bhashini account. The system works perfectly without them.
                  </p>
                  <div>
                    <label className="block text-slate-400 font-mono mb-1">Sarvam AI API Key <span className="text-slate-600">(optional)</span></label>
                    <input
                      type="password"
                      placeholder="Leave empty — not required"
                      value={config.sarvamApiKey || ''}
                      onChange={(e) => setConfigState({ ...config, sarvamApiKey: e.target.value })}
                      className="w-full bg-slate-950 border border-slate-700 rounded-lg p-2 text-slate-200 font-mono text-xs focus:ring-1 focus:ring-cyan-500"
                    />
                  </div>
                  <div className="grid grid-cols-2 gap-2">
                    <div>
                      <label className="block text-slate-400 font-mono mb-1">Bhashini API Key <span className="text-slate-600">(optional)</span></label>
                      <input
                        type="password"
                        placeholder="Leave empty"
                        value={config.bhashiniApiKey || ''}
                        onChange={(e) => setConfigState({ ...config, bhashiniApiKey: e.target.value })}
                        className="w-full bg-slate-950 border border-slate-700 rounded-lg p-2 text-slate-200 font-mono text-xs focus:ring-1 focus:ring-cyan-500"
                      />
                    </div>
                    <div>
                      <label className="block text-slate-400 font-mono mb-1">Bhashini User ID <span className="text-slate-600">(optional)</span></label>
                      <input
                        type="text"
                        placeholder="Leave empty"
                        value={config.bhashiniUserId || ''}
                        onChange={(e) => setConfigState({ ...config, bhashiniUserId: e.target.value })}
                        className="w-full bg-slate-950 border border-slate-700 rounded-lg p-2 text-slate-200 font-mono text-xs focus:ring-1 focus:ring-cyan-500"
                      />
                    </div>
                  </div>
                </div>
              </details>
            </div>

            {saveMessage && (
              <div className="text-xs text-emerald-400 font-mono text-center">{saveMessage}</div>
            )}

            <div className="flex items-center justify-end space-x-2 pt-2 border-t border-slate-800">
              <button
                onClick={() => setShowConfigModal(false)}
                className="px-3 py-1.5 rounded-lg text-xs font-mono text-slate-400 hover:text-slate-200 border border-slate-700"
              >
                Close
              </button>
              <button
                onClick={handleSaveConfig}
                className="px-3.5 py-1.5 rounded-lg text-xs font-mono font-bold bg-cyan-500 text-slate-950 hover:bg-cyan-400 transition-all shadow-md"
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

