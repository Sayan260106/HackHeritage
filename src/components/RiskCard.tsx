import React, { useState } from 'react';
import { 
  ShieldAlert, 
  ShieldCheck, 
  AlertTriangle, 
  AlertOctagon, 
  Volume2, 
  VolumeX, 
  CheckCircle2, 
  XCircle, 
  Anchor, 
  Clock, 
  Cpu, 
  HelpCircle,
  FileText,
  Printer
} from 'lucide-react';
import { RiskPrediction, LanguageCode, LocationInfo, TimeWindow, GeofenceSpatialAnalysis } from '../types';
import { MULTILINGUAL_DICTIONARY } from '../data/coastalData';
import { maritimeSiren } from '../services/audio/maritimeSirenService';
import { voiceWarning } from '../services/audio/voiceWarningService';

interface RiskCardProps {
  risk: RiskPrediction;
  location: LocationInfo;
  timeWindow: TimeWindow;
  language: LanguageCode;
  groundedSummary: string;
  geofenceAnalysis?: GeofenceSpatialAnalysis;
}

export const RiskCard: React.FC<RiskCardProps> = ({
  risk,
  location,
  timeWindow,
  language,
  groundedSummary,
  geofenceAnalysis
}) => {
  const [isPlayingAudio, setIsPlayingAudio] = useState<boolean>(false);
  const dict = MULTILINGUAL_DICTIONARY[language] || MULTILINGUAL_DICTIONARY.en;

  // Speak the verdict using browser SpeechSynthesis & Maritime Siren
  const handleToggleAudio = async () => {
    if (isPlayingAudio) {
      voiceWarning.cancel();
      maritimeSiren.stop();
      setIsPlayingAudio(false);
      return;
    }

    await maritimeSiren.unlock();
    setIsPlayingAudio(true);

    const isBreach =
      geofenceAnalysis?.inRestrictedWaters ||
      geofenceAnalysis?.status === 'RESTRICTED_BREACH' ||
      geofenceAnalysis?.activeAlerts?.some((a) => a.severity === 'CRITICAL_BREACH');
    const isCaution =
      !isBreach &&
      (geofenceAnalysis?.status === 'CAUTION' ||
        geofenceAnalysis?.activeAlerts?.some((a) => a.severity === 'PROXIMITY_WARNING'));

    // Prioritize geofence breach/proximity announcements
    if (isBreach) {
      // Pick the most critical alert (CRITICAL_BREACH first, then by nearest distance)
      const criticalAlert =
        geofenceAnalysis?.activeAlerts?.find((a) => a.severity === 'CRITICAL_BREACH') ||
        geofenceAnalysis?.activeAlerts?.[0];
      const fallbackAlert = geofenceAnalysis?.nearestImbl || geofenceAnalysis?.nearestMpa;
      const alert = criticalAlert || fallbackAlert;
      if (alert) {
        const alertWithSeverity = { ...alert, severity: 'CRITICAL_BREACH' as const };
        const phrase = voiceWarning.generateGeofencePhrase(alertWithSeverity, language);
        await voiceWarning.speak(phrase, language, { playSirenFirst: true, isCritical: true, force: true });
        setIsPlayingAudio(false);
        return;
      }
    }

    if (isCaution) {
      const alert =
        geofenceAnalysis?.activeAlerts?.find((a) => a.severity === 'PROXIMITY_WARNING') ||
        geofenceAnalysis?.activeAlerts?.[0] ||
        geofenceAnalysis?.nearestImbl ||
        geofenceAnalysis?.nearestMpa;
      if (alert) {
        const alertWithSeverity = { ...alert, severity: 'PROXIMITY_WARNING' as const };
        const phrase = voiceWarning.generateGeofencePhrase(alertWithSeverity, language);
        await voiceWarning.speak(phrase, language, { playSirenFirst: true, isCritical: false, force: true });
        setIsPlayingAudio(false);
        return;
      }
    }

    // No geofence alert — speak the risk verdict (weather/safety status)
    const isCritical = risk.riskLevel === 'EXTREME' || risk.riskLevel === 'HIGH';
    const textToSpeak = voiceWarning.generateRiskVerdictPhrase(location, risk, undefined, language);
    await voiceWarning.speak(textToSpeak, language, { playSirenFirst: true, isCritical, force: true });
    setIsPlayingAudio(false);
  };

  // Semantic styles for Risk Level (Minimalist Premium UI)
  const getRiskTheme = (level: string) => {
    // Base elegant glass container for all states
    const baseBg = 'bg-[#090d16]/80 border-slate-800/60 text-slate-300';
    
    switch (level) {
      case 'LOW':
        return {
          bg: baseBg,
          badgeBg: 'badge-neon-low',
          icon: <ShieldCheck className="h-5 w-5 text-emerald-400" />,
          gaugeColor: '#34d399',
        };
      case 'MODERATE':
        return {
          bg: baseBg,
          badgeBg: 'badge-neon-moderate',
          icon: <AlertTriangle className="h-5 w-5 text-amber-400" />,
          gaugeColor: '#fbbf24',
        };
      case 'HIGH':
        return {
          bg: baseBg,
          badgeBg: 'badge-neon-high',
          icon: <AlertTriangle className="h-5 w-5 text-orange-400" />,
          gaugeColor: '#fb923c',
        };
      case 'EXTREME':
      default:
        return {
          bg: baseBg,
          badgeBg: 'badge-neon-extreme',
          icon: <AlertOctagon className="h-5 w-5 text-rose-500" />,
          gaugeColor: '#e11d48',
        };
    }
  };

  const theme = getRiskTheme(risk.riskLevel);

  return (
    <div className={`rounded-2xl border ${theme.bg} p-6 shadow-2xl shadow-black/40 space-y-6 transition-all backdrop-blur-md`}>
      
      {/* ADVISORY BANNER (Premium Minimalist Strip) */}
      {(() => {
        // Geofence breach overrides weather risk
        const hasGeofenceBreach =
          geofenceAnalysis?.inRestrictedWaters ||
          geofenceAnalysis?.status === 'RESTRICTED_BREACH' ||
          geofenceAnalysis?.activeAlerts?.some((a) => a.severity === 'CRITICAL_BREACH');
        const hasGeofenceCaution =
          !hasGeofenceBreach &&
          (geofenceAnalysis?.status === 'CAUTION' ||
            geofenceAnalysis?.activeAlerts?.some((a) => a.severity === 'PROXIMITY_WARNING'));

        // Determine sleek banner style
        const bannerClass = hasGeofenceBreach
          ? 'bg-rose-950/40 border-l-4 border-l-rose-500 border-y border-y-rose-900/30 border-r border-r-rose-900/30 text-rose-200'
          : hasGeofenceCaution
          ? 'bg-amber-950/40 border-l-4 border-l-amber-500 border-y border-y-amber-900/30 border-r border-r-amber-900/30 text-amber-200'
          : risk.riskLevel === 'LOW'
          ? 'bg-emerald-950/30 border-l-4 border-l-emerald-500 border-y border-y-emerald-900/30 border-r border-r-emerald-900/30 text-emerald-200'
          : risk.riskLevel === 'MODERATE'
          ? 'bg-amber-950/40 border-l-4 border-l-amber-500 border-y border-y-amber-900/30 border-r border-r-amber-900/30 text-amber-200'
          : 'bg-rose-950/40 border-l-4 border-l-rose-500 border-y border-y-rose-900/30 border-r border-r-rose-900/30 text-rose-200';

        const bannerIcon = hasGeofenceBreach
          ? <AlertOctagon className="h-5 w-5 text-rose-500" />
          : hasGeofenceCaution
          ? <AlertTriangle className="h-5 w-5 text-amber-400" />
          : theme.icon;

        // Banner headline
        const bannerHeadline = hasGeofenceBreach
          ? 'MARITIME BREACH'
          : hasGeofenceCaution
          ? 'BOUNDARY PROXIMITY'
          : risk.riskLevel === 'LOW'
          ? 'SAFE TO SAIL'
          : risk.riskLevel === 'MODERATE'
          ? 'CAUTION ADVISED'
          : 'DO NOT SAIL';

        // Sub-message: for breach, show localized native-language phrase with real distance
        const breachAlert =
          geofenceAnalysis?.activeAlerts?.find((a) => a.severity === 'CRITICAL_BREACH') ||
          geofenceAnalysis?.activeAlerts?.find((a) => a.severity === 'PROXIMITY_WARNING');
        const bannerSubtext = hasGeofenceBreach && breachAlert
          ? voiceWarning.generateGeofencePhrase({ ...breachAlert, severity: 'CRITICAL_BREACH' }, language)
          : hasGeofenceCaution && breachAlert
          ? voiceWarning.generateGeofencePhrase({ ...breachAlert, severity: 'PROXIMITY_WARNING' }, language)
          : risk.primaryRecommendation;

        return (
          <div className={`p-4 rounded-xl border-2 flex flex-col sm:flex-row items-center justify-between gap-3 text-center sm:text-left ${bannerClass}`}>
            <div className="flex items-center space-x-3">
              <div className="p-2.5 rounded-full bg-slate-950/40 shrink-0">
                {bannerIcon}
              </div>
              <div>
                <span className="text-[10px] font-mono uppercase tracking-widest opacity-80 block">
                  {location.name} • {hasGeofenceBreach ? 'Geofence Breach Alert' : hasGeofenceCaution ? 'Boundary Proximity Alert' : 'Official Sea Advisory'}
                </span>
                <h2 className="text-xl sm:text-2xl font-black tracking-tight leading-none mt-0.5">
                  {bannerHeadline}
                </h2>
                <p className="text-xs font-semibold opacity-90 mt-1">
                  {bannerSubtext}
                </p>
              </div>
            </div>

        {/* Big One-Handed Listen Button */}
        <button
          id="btn-risk-audio-narration"
          onClick={handleToggleAudio}
          title={isPlayingAudio ? 'Stop audio' : 'Listen to marine risk summary'}
          className={`w-full sm:w-auto min-h-[52px] px-5 py-3 rounded-xl text-xs sm:text-sm font-bold border transition-all flex items-center justify-center space-x-2 shrink-0 ${
            isPlayingAudio
              ? 'bg-cyan-400 text-slate-950 border-cyan-300 shadow-lg shadow-cyan-400/50 animate-pulse'
              : 'bg-slate-900 hover:bg-slate-800 text-slate-100 border-slate-600 active:scale-95'
          }`}
        >
          {isPlayingAudio ? <VolumeX className="h-5 w-5" /> : <Volume2 className="h-5 w-5 text-cyan-400" />}
          <span>{isPlayingAudio ? 'Stop Audio' : '🔊 Listen Warning'}</span>
        </button>
          </div>
        );
      })()}

      {/* Header with Risk Level Badge & Audio Narration */}
      <div className="flex items-start justify-between pt-1">
        <div>
          <div className="flex items-center space-x-2">
            <span className="text-[11px] font-mono uppercase tracking-wider text-slate-400">
              {dict.machineLearningAssessment}
            </span>
            <span className="text-[10px] font-mono px-1.5 py-0.5 rounded bg-slate-900 border border-slate-700 text-slate-400">
              {risk.modelVersion}
            </span>
          </div>
          <h3 className="text-xl font-extrabold text-slate-100 flex items-center gap-2 mt-1">
            <span>{location.name}</span>
          </h3>
          <p className="text-xs text-slate-400 flex items-center gap-1.5 mt-0.5 font-mono">
            <Clock className="h-3 w-3 text-cyan-400" />
            <span>{dict.targetWindow}: {timeWindow.requestedText === 'Current Conditions' ? dict.currentConditions : timeWindow.requestedText}</span>
          </p>
        </div>

        <div className="flex items-center space-x-2">
          {/* Print Bulletin Button */}
          <button
            id="btn-print-advisory-bulletin"
            onClick={() => window.print()}
            title="Print Official Safety Bulletin"
            className="flex items-center space-x-1.5 min-h-[44px] px-3.5 py-2 rounded-xl text-xs font-semibold border border-slate-700 bg-slate-900/90 hover:bg-slate-800 text-slate-200 transition-all"
          >
            <Printer className="h-4 w-4 text-cyan-400" />
            <span className="hidden sm:inline">Print Bulletin</span>
          </button>

          {/* Audio TTS Button */}
          <button
            id="btn-risk-audio-narration"
            onClick={handleToggleAudio}
            title={isPlayingAudio ? 'Stop audio' : 'Listen to marine risk summary'}
            className={`flex items-center space-x-1.5 min-h-[44px] px-3 py-2 rounded-xl text-xs font-semibold border transition-all ${
              isPlayingAudio
                ? 'bg-cyan-500 text-slate-950 border-cyan-400 animate-pulse shadow-md shadow-cyan-500/50'
                : 'bg-slate-900/90 hover:bg-slate-800 text-slate-200 border-slate-700'
            }`}
          >
            {isPlayingAudio ? <VolumeX className="h-4 w-4" /> : <Volume2 className="h-4 w-4 text-cyan-400" />}
            <span className="hidden sm:inline">{isPlayingAudio ? (dict.listening || 'Speaking...') : (dict.listenAudio || 'Listen Audio')}</span>
          </button>
        </div>
      </div>

      {/* Main Score & Categorical Card */}
      <div className="flex flex-col md:flex-row gap-6 items-center md:items-start bg-[#0b121f]/50 border border-slate-800/40 rounded-xl p-6 shadow-inner">
        
        {/* Score Circular Gauge */}
        <div className="flex items-center space-x-6 md:border-r border-slate-800/60 md:pr-6 shrink-0">
          <div className="relative w-16 h-16 shrink-0 flex items-center justify-center">
            {/* SVG Circle Progress */}
            <svg className="w-full h-full transform -rotate-90" viewBox="0 0 36 36">
              <path
                className="text-slate-800/40"
                strokeWidth="2.5"
                stroke="currentColor"
                fill="none"
                d="M18 2.0845 a 15.9155 15.9155 0 0 1 0 31.831 a 15.9155 15.9155 0 0 1 0 -31.831"
              />
              <path
                strokeDasharray={`${risk.riskScore}, 100`}
                strokeWidth="2.5"
                strokeLinecap="round"
                stroke={theme.gaugeColor}
                fill="none"
                d="M18 2.0845 a 15.9155 15.9155 0 0 1 0 31.831 a 15.9155 15.9155 0 0 1 0 -31.831"
                className="transition-all duration-1000 ease-out"
              />
            </svg>
            <div className="absolute flex flex-col items-center justify-center mt-0.5">
              <span className="text-lg font-bold text-white font-mono tabular-nums leading-none tracking-tight">{risk.riskScore}</span>
            </div>
          </div>

          <div className="flex flex-col justify-center space-y-1.5">
            <div className="flex items-center space-x-2">
              <span className={`px-2 py-0.5 rounded text-[10px] font-bold uppercase tracking-widest border ${theme.badgeBg}`}>
                {risk.riskLevel === 'LOW' ? dict.lowRisk : risk.riskLevel === 'MODERATE' ? dict.moderateRisk : risk.riskLevel === 'HIGH' ? dict.highRisk : dict.extremeRisk}
              </span>
            </div>
            <div className="text-[10px] text-slate-500 font-mono flex items-center gap-1.5 uppercase tracking-wider">
              <Cpu className="h-3 w-3 text-slate-400" />
              <span>Model Conf: <span className="text-slate-300 tabular-nums font-semibold">{risk.confidenceScore}%</span></span>
            </div>
          </div>
        </div>

        {/* Primary Verdict & Safety Recommendation */}
        <div className="space-y-2 flex-1 pt-1">
          <div className="text-[10px] uppercase tracking-widest font-semibold text-slate-500 flex items-center gap-2">
            <span className="h-1.5 w-1.5 rounded-full bg-slate-400/50"></span>
            <span>{dict.primaryDirective}</span>
          </div>
          <p className="text-sm font-medium text-slate-200 leading-relaxed max-w-xl">
            {risk.primaryRecommendation}
          </p>
          <p className="text-xs text-slate-400/80 leading-relaxed line-clamp-2 max-w-xl font-mono mt-2">
            {risk.safetySummary}
          </p>
        </div>
      </div>

      {/* Geofencing & Boundary Security Alert Banner */}
      {geofenceAnalysis && (
        <div className={`rounded-xl p-3.5 border space-y-2.5 text-xs transition-all ${
          geofenceAnalysis.status === 'RESTRICTED_BREACH'
            ? 'bg-red-950/60 border-red-600/80 text-red-200 shadow-[0_0_18px_rgba(239,68,68,0.25)]'
            : geofenceAnalysis.status === 'CAUTION'
            ? 'bg-amber-950/50 border-amber-500/60 text-amber-200 shadow-[0_0_12px_rgba(245,158,11,0.15)]'
            : 'bg-slate-900/60 border-slate-800 text-slate-300'
        }`}>
          <div className="flex items-start justify-between gap-2">
            <div className="flex items-center gap-2 font-bold">
              <ShieldAlert className={`h-4 w-4 shrink-0 ${
                geofenceAnalysis.status === 'RESTRICTED_BREACH' ? 'text-red-400 animate-pulse' :
                geofenceAnalysis.status === 'CAUTION' ? 'text-amber-400' : 'text-emerald-400'
              }`} />
              <span className="uppercase tracking-wider font-mono text-[11px]">
                {geofenceAnalysis.status === 'RESTRICTED_BREACH' ? '🚨 Sovereign Maritime Incursion Alert' :
                 geofenceAnalysis.status === 'CAUTION' ? '⚠️ Border & Ecological Caution Active' :
                 '🛡️ Sovereign Maritime Boundary Clearance'}
              </span>
            </div>
            <span className={`px-2 py-0.5 rounded text-[10px] font-mono font-black uppercase ${
              geofenceAnalysis.status === 'RESTRICTED_BREACH' ? 'bg-red-600 text-white animate-pulse' :
              geofenceAnalysis.status === 'CAUTION' ? 'bg-amber-500 text-slate-950' :
              'bg-emerald-500/20 text-emerald-400 border border-emerald-500/40'
            }`}>
              {geofenceAnalysis.status}
            </span>
          </div>

          <p className="text-xs leading-relaxed font-medium">
            {geofenceAnalysis.activeAlerts.length > 0 
              ? geofenceAnalysis.activeAlerts[0].warningMessage 
              : `Vessel has clear operational waters. Operating point is ${geofenceAnalysis.nearestImbl?.distanceNm ?? '>15'} NM from the nearest International Maritime Boundary Line (${geofenceAnalysis.nearestImbl?.boundaryName.split('(')[0] || 'IMBL'}).`}
          </p>

          {/* Detailed Boundary Proximity Grid */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 pt-1 border-t border-slate-800/80 text-[11px] font-mono">
            {geofenceAnalysis.nearestImbl && (
              <div className="bg-slate-950/60 p-2 rounded-lg border border-slate-800/60 space-y-0.5">
                <div className="flex items-center justify-between text-slate-300 font-bold">
                  <span className="truncate max-w-[150px]">{geofenceAnalysis.nearestImbl.boundaryName.split('(')[0]}</span>
                  <span className={geofenceAnalysis.nearestImbl.hasCrossedBorder ? 'text-red-400 font-black animate-pulse' : geofenceAnalysis.nearestImbl.distanceNm <= 3.0 ? 'text-red-400 font-black' : geofenceAnalysis.nearestImbl.distanceNm <= 8.0 ? 'text-amber-400' : 'text-slate-300'}>
                    {geofenceAnalysis.nearestImbl.hasCrossedBorder ? `CROSSED (${geofenceAnalysis.nearestImbl.distanceNm} NM)` : `${geofenceAnalysis.nearestImbl.distanceNm} NM`}
                  </span>
                </div>
                <div className="text-[10px] text-slate-400 flex items-center justify-between">
                  <span>{geofenceAnalysis.nearestImbl.hasCrossedBorder ? 'Return Heading' : 'Bearing'}: {geofenceAnalysis.nearestImbl.bearingDeg ?? 0}°</span>
                  <span className={geofenceAnalysis.nearestImbl.hasCrossedBorder ? 'text-red-400 font-bold' : 'text-cyan-400/80'}>{geofenceAnalysis.nearestImbl.hasCrossedBorder ? 'BORDER BREACH' : geofenceAnalysis.nearestImbl.severity.replace('_', ' ')}</span>
                </div>
              </div>
            )}

            {geofenceAnalysis.nearestMpa && (
              <div className="bg-slate-950/60 p-2 rounded-lg border border-slate-800/60 space-y-0.5">
                <div className="flex items-center justify-between text-slate-300 font-bold">
                  <span className="truncate max-w-[150px]">{geofenceAnalysis.nearestMpa.boundaryName.split(' ')[0]} Sanctuary</span>
                  <span className={(geofenceAnalysis.nearestMpa.isInside || geofenceAnalysis.nearestMpa.distanceNm === 0) ? 'text-red-400 font-black animate-pulse' : geofenceAnalysis.nearestMpa.distanceNm <= 3.0 ? 'text-amber-400' : 'text-emerald-400'}>
                    {(geofenceAnalysis.nearestMpa.isInside || geofenceAnalysis.nearestMpa.distanceNm === 0)
                      ? `INSIDE (${geofenceAnalysis.nearestMpa.insideDepthNm ?? geofenceAnalysis.nearestMpa.distanceNm} NM)`
                      : `${geofenceAnalysis.nearestMpa.distanceNm} NM`}
                  </span>
                </div>
                <div className="text-[10px] text-slate-400 flex items-center justify-between">
                  <span>{(geofenceAnalysis.nearestMpa.isInside || geofenceAnalysis.nearestMpa.distanceNm === 0) ? `Escape Heading: ${geofenceAnalysis.nearestMpa.escapeBearingDeg ?? geofenceAnalysis.nearestMpa.bearingDeg ?? 0}°` : 'Ecological Buffer'}</span>
                  <span className={(geofenceAnalysis.nearestMpa.isInside || geofenceAnalysis.nearestMpa.distanceNm === 0) ? 'text-red-400 font-bold' : 'text-emerald-400/80'}>
                    {(geofenceAnalysis.nearestMpa.isInside || geofenceAnalysis.nearestMpa.distanceNm === 0) ? 'SANCTUARY INVASION' : geofenceAnalysis.nearestMpa.severity.replace('_', ' ')}
                  </span>
                </div>
              </div>
            )}
          </div>
        </div>
      )}

      {/* Craft Restrictions & Safe Vessel Matrix */}
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 text-xs">
        
        {/* Permitted Craft Types */}
        <div className="bg-emerald-950/30 border border-emerald-900/40 rounded-xl p-3 space-y-1.5">
          <div className="flex items-center space-x-1.5 font-bold text-emerald-400">
            <CheckCircle2 className="h-3.5 w-3.5" />
            <span>{dict.permittedVessels}</span>
          </div>
          <ul className="space-y-1 text-slate-300 text-[11px]">
            {risk.safeCraftTypes.length > 0 ? (
              risk.safeCraftTypes.map((craft, i) => (
                <li key={i} className="flex items-center space-x-1.5">
                  <span className="h-1 w-1 rounded-full bg-emerald-400 shrink-0"></span>
                  <span>{craft}</span>
                </li>
              ))
            ) : (
              <li className="text-slate-400 italic">{dict.noCraftsCleared}</li>
            )}
          </ul>
        </div>

        {/* Restricted / Embargoed Craft Types */}
        <div className="bg-rose-950/30 border border-rose-900/40 rounded-xl p-3 space-y-1.5">
          <div className="flex items-center space-x-1.5 font-bold text-rose-400">
            <XCircle className="h-3.5 w-3.5" />
            <span>{dict.restrictedVessels}</span>
          </div>
          <ul className="space-y-1 text-slate-300 text-[11px]">
            {risk.restrictedCraftTypes.length > 0 ? (
              risk.restrictedCraftTypes.map((craft, i) => (
                <li key={i} className="flex items-center space-x-1.5">
                  <span className="h-1 w-1 rounded-full bg-rose-400 shrink-0"></span>
                  <span>{craft}</span>
                </li>
              ))
            ) : (
              <li className="text-emerald-400/80 italic">{dict.noRestrictions}</li>
            )}
          </ul>
        </div>

      </div>

      {/* Actionable Safety Bulletins Checklist */}
      <div className="bg-slate-950/80 border border-slate-800 rounded-xl p-3 space-y-2">
        <div className="text-xs font-bold text-slate-200 flex items-center justify-between">
          <span className="flex items-center gap-1.5">
            <FileText className="h-3.5 w-3.5 text-cyan-400" />
            <span>{dict.recommendations}</span>
          </span>
          <span className="text-[10px] font-mono text-cyan-400">
            {dict.validUntil}: {new Date(risk.validUntil).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
          </span>
        </div>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 text-[11px] text-slate-300">
          {risk.actionableAdvisories.map((advisory, idx) => (
            <div key={idx} className="flex items-start space-x-2 bg-slate-900/60 p-2 rounded-lg border border-slate-800/60">
              <span className="text-cyan-400 font-bold font-mono shrink-0">#{idx + 1}</span>
              <span className="leading-snug">{advisory}</span>
            </div>
          ))}
        </div>
      </div>

    </div>
  );
};
