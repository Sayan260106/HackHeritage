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
import { RiskPrediction, LanguageCode, LocationInfo, TimeWindow, GeofenceSpatialAnalysis, selectPriorityGeofenceAlert } from '../types';
import { MULTILINGUAL_DICTIONARY } from '../data/coastalData';
import { maritimeSiren } from '../services/audio/maritimeSirenService';
import { voiceWarning } from '../services/audio/voiceWarningService';

interface RiskCardProps {
  risk: RiskPrediction;
  location: LocationInfo;
  timeWindow?: TimeWindow;
  language: LanguageCode;
  groundedSummary?: string;
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

  const isHighRisk = risk.riskLevel === 'HIGH' || risk.riskLevel === 'EXTREME';
  const isModerateRisk = risk.riskLevel === 'MODERATE';
  const isLowRisk = risk.riskLevel === 'LOW';

  // Speak the verdict using browser SpeechSynthesis & Maritime Siren
  const handleToggleAudio = async () => {
    if (isPlayingAudio) {
      maritimeSiren.stop();
      voiceWarning.cancel();
      setIsPlayingAudio(false);
      return;
    }

    setIsPlayingAudio(true);
    await maritimeSiren.unlock();

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
      const alert = selectPriorityGeofenceAlert(geofenceAnalysis);
      if (alert) {
        const alertWithSeverity = { ...alert, severity: 'CRITICAL_BREACH' as const };
        const phrase = voiceWarning.generateGeofencePhrase(alertWithSeverity, language);
        await voiceWarning.speak(phrase, language, { playSirenFirst: true, isCritical: true, force: true });
        setIsPlayingAudio(false);
        return;
      }
    }

    if (isCaution) {
      const alert = selectPriorityGeofenceAlert(geofenceAnalysis);
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

  // Semantic styles for Risk Level (Minimalist Premium Light UI)
  const getRiskTheme = (level: string) => {
    const baseBg = 'bg-white border-slate-200/90 text-slate-800';
    
    switch (level) {
      case 'LOW':
        return {
          bg: baseBg,
          badgeBg: 'badge-neon-low',
          icon: <ShieldCheck className="h-5 w-5 text-emerald-600" />,
          gaugeColor: '#059669',
        };
      case 'MODERATE':
        return {
          bg: baseBg,
          badgeBg: 'badge-neon-moderate',
          icon: <AlertTriangle className="h-5 w-5 text-amber-500" />,
          gaugeColor: '#d97706',
        };
      case 'HIGH':
        return {
          bg: baseBg,
          badgeBg: 'badge-neon-high',
          icon: <AlertTriangle className="h-5 w-5 text-orange-500" />,
          gaugeColor: '#ea580c',
        };
      case 'EXTREME':
      default:
        return {
          bg: baseBg,
          badgeBg: 'badge-neon-extreme',
          icon: <AlertOctagon className="h-5 w-5 text-rose-600" />,
          gaugeColor: '#dc2626',
        };
    }
  };

  const theme = getRiskTheme(risk.riskLevel);

  return (
    <div className="apple-glass-card rounded-3xl p-6 sm:p-7 shadow-[0_8px_32px_-4px_rgba(15,23,42,0.05),inset_0_1px_0_rgba(255,255,255,1)] space-y-6 transition-all">
      
      {/* ADVISORY BANNER (Clean Light Marine Strip) */}
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
          ? 'bg-gradient-to-r from-rose-500/12 via-rose-500/8 to-rose-500/5 border border-rose-300/80 shadow-[0_4px_24px_-2px_rgba(244,63,94,0.12),inset_0_1px_0_rgba(255,255,255,0.9)] text-rose-950'
          : hasGeofenceCaution
          ? 'bg-gradient-to-r from-amber-500/12 via-amber-500/8 to-amber-500/5 border border-amber-300/80 shadow-[0_4px_24px_-2px_rgba(245,158,11,0.12),inset_0_1px_0_rgba(255,255,255,0.9)] text-amber-950'
          : risk.riskLevel === 'LOW'
          ? 'bg-gradient-to-r from-emerald-500/12 via-teal-500/8 to-emerald-500/5 border border-emerald-300/80 shadow-[0_4px_24px_-2px_rgba(16,185,129,0.12),inset_0_1px_0_rgba(255,255,255,0.9)] text-emerald-950'
          : risk.riskLevel === 'MODERATE'
          ? 'bg-gradient-to-r from-amber-500/12 via-amber-500/8 to-amber-500/5 border border-amber-300/80 shadow-[0_4px_24px_-2px_rgba(245,158,11,0.12),inset_0_1px_0_rgba(255,255,255,0.9)] text-amber-950'
          : 'bg-gradient-to-r from-rose-500/12 via-rose-500/8 to-rose-500/5 border border-rose-300/80 shadow-[0_4px_24px_-2px_rgba(244,63,94,0.12),inset_0_1px_0_rgba(255,255,255,0.9)] text-rose-950';

        const bannerIcon = hasGeofenceBreach
          ? <AlertOctagon className="h-5 w-5 text-rose-600" />
          : hasGeofenceCaution
          ? <AlertTriangle className="h-5 w-5 text-amber-600" />
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
          <div className={`p-5 rounded-2xl border flex flex-col sm:flex-row items-center justify-between gap-4 text-center sm:text-left ${bannerClass}`}>
            <div className="flex items-center space-x-3.5">
              <div className="p-3 rounded-2xl bg-white/95 shadow-sm border border-white shrink-0">
                {bannerIcon}
              </div>
              <div>
                <span className="text-[10px] font-mono uppercase tracking-widest font-bold opacity-75 block">
                  {location.name} • {hasGeofenceBreach ? 'Geofence Breach Alert' : hasGeofenceCaution ? 'Boundary Proximity Alert' : 'Official Sea Advisory'}
                </span>
                <h2 className="text-xl sm:text-2xl font-black tracking-tight leading-none mt-1">
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
          className={`w-full sm:w-auto min-h-[50px] px-5 py-2.5 rounded-2xl text-xs sm:text-sm font-semibold border transition-all flex items-center justify-center space-x-2 shrink-0 cursor-pointer ${
            isPlayingAudio
              ? 'bg-gradient-to-r from-sky-600 to-cyan-600 text-white border-sky-500 shadow-md shadow-sky-500/30 animate-pulse'
              : 'bg-white/95 hover:bg-white text-slate-800 border-slate-200/90 shadow-2xs hover:shadow-xs active:scale-95'
          }`}
        >
          {isPlayingAudio ? <VolumeX className="h-5 w-5 text-white" /> : <Volume2 className="h-5 w-5 text-sky-600" />}
          <span>{isPlayingAudio ? 'Stop Audio' : '🔊 Listen Warning'}</span>
        </button>
          </div>
        );
      })()}

      {/* Header with Risk Level Badge & Audio Narration */}
      <div className="flex items-start justify-between pt-1">
        <div>
          <div className="flex items-center space-x-2">
            <span className="text-[11px] font-mono uppercase tracking-wider text-slate-500 font-semibold">
              {dict.machineLearningAssessment}
            </span>
            <span className="text-[10px] font-mono px-2 py-0.5 rounded-md bg-slate-100 border border-slate-200 text-slate-600 font-semibold">
              {risk.modelVersion}
            </span>
          </div>
          <h3 className="text-xl font-extrabold text-slate-900 flex items-center gap-2 mt-1">
            <span>{location.name}</span>
          </h3>
          <p className="text-xs text-slate-500 flex items-center gap-1.5 mt-0.5 font-mono">
            <Clock className="h-3 w-3 text-sky-600" />
            <span>{dict.targetWindow}: {timeWindow?.requestedText === 'Current Conditions' ? dict.currentConditions : timeWindow?.requestedText || 'Current'}</span>
          </p>
        </div>

        <div className="flex items-center space-x-2">
          {/* Print Bulletin Button */}
          <button
            id="btn-print-advisory-bulletin"
            onClick={() => window.print()}
            title="Print Official Safety Bulletin"
            className="flex items-center space-x-1.5 min-h-[42px] px-3.5 py-2 rounded-xl text-xs font-semibold border border-slate-200 bg-white hover:bg-slate-50 text-slate-700 shadow-2xs transition-all"
          >
            <Printer className="h-4 w-4 text-sky-600" />
            <span className="hidden sm:inline">Print Bulletin</span>
          </button>

          {/* Audio TTS Button */}
          <button
            id="btn-risk-audio-narration"
            onClick={handleToggleAudio}
            title={isPlayingAudio ? 'Stop audio' : 'Listen to marine risk summary'}
            className={`flex items-center space-x-1.5 min-h-[42px] px-3.5 py-2 rounded-xl text-xs font-semibold border transition-all ${
              isPlayingAudio
                ? 'bg-sky-600 text-white border-sky-600 animate-pulse shadow-md shadow-sky-600/30'
                : 'bg-white hover:bg-slate-50 text-slate-700 border-slate-200 shadow-2xs'
            }`}
          >
            {isPlayingAudio ? <VolumeX className="h-4 w-4" /> : <Volume2 className="h-4 w-4 text-sky-600" />}
            <span className="hidden sm:inline">{isPlayingAudio ? (dict.listening || 'Speaking...') : (dict.listenAudio || 'Listen Audio')}</span>
          </button>
        </div>
      </div>

      {/* Main Score & Categorical Card */}
      <div className="flex flex-col md:flex-row gap-6 items-center md:items-start bg-slate-50/80 border border-slate-200/80 rounded-2xl p-6 shadow-xs">
        
        {/* Score Circular Gauge */}
        <div className="flex items-center space-x-6 md:border-r border-slate-200 md:pr-6 shrink-0">
          <div className="relative w-16 h-16 shrink-0 flex items-center justify-center">
            {/* SVG Circle Progress */}
            <svg className="w-full h-full transform -rotate-90" viewBox="0 0 36 36">
              <path
                className="text-slate-200"
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
              <span className="text-lg font-bold text-slate-900 font-mono tabular-nums leading-none tracking-tight">{risk.riskScore}</span>
            </div>
          </div>

          <div className="flex flex-col justify-center space-y-1.5">
            <div className="flex items-center space-x-2">
              <span className={`px-2.5 py-0.5 rounded-md text-[10px] font-bold uppercase tracking-wider border ${theme.badgeBg}`}>
                {risk.riskLevel === 'LOW' ? dict.lowRisk : risk.riskLevel === 'MODERATE' ? dict.moderateRisk : risk.riskLevel === 'HIGH' ? dict.highRisk : dict.extremeRisk}
              </span>
            </div>
            <div className="text-[10px] text-slate-500 font-mono flex items-center gap-1.5 uppercase tracking-wider">
              <Cpu className="h-3 w-3 text-slate-400" />
              <span>Model Conf: <span className="text-slate-700 tabular-nums font-bold">{risk.confidenceScore}%</span></span>
            </div>
          </div>
        </div>

        {/* Primary Verdict & Safety Recommendation */}
        <div className="space-y-2 flex-1 pt-1">
          <div className="text-[10px] uppercase tracking-wider font-bold text-slate-500 flex items-center gap-2">
            <span className="h-1.5 w-1.5 rounded-full bg-sky-500"></span>
            <span>{dict.primaryDirective}</span>
          </div>
          <p className="text-sm font-semibold text-slate-900 leading-relaxed max-w-xl">
            {risk.primaryRecommendation}
          </p>
          <p className="text-xs text-slate-600 leading-relaxed line-clamp-2 max-w-xl font-mono mt-1">
            {risk.safetySummary}
          </p>
        </div>
      </div>

      {/* Geofencing & Boundary Security Alert Banner */}
      {geofenceAnalysis && (
        <div className={`rounded-2xl p-4 border space-y-2.5 text-xs transition-all ${
          geofenceAnalysis.status === 'RESTRICTED_BREACH'
            ? 'bg-rose-50 border-rose-200 text-rose-950 shadow-xs'
            : geofenceAnalysis.status === 'CAUTION'
            ? 'bg-amber-50 border-amber-200 text-amber-950 shadow-xs'
            : 'bg-emerald-50/70 border-emerald-200 text-emerald-950 shadow-xs'
        }`}>
          <div className="flex items-start justify-between gap-2">
            <div className="flex items-center gap-2 font-bold">
              <ShieldAlert className={`h-4 w-4 shrink-0 ${
                geofenceAnalysis.status === 'RESTRICTED_BREACH' ? 'text-rose-600 animate-pulse' :
                geofenceAnalysis.status === 'CAUTION' ? 'text-amber-600' : 'text-emerald-600'
              }`} />
              <span className="uppercase tracking-wider font-mono text-[11px]">
                {geofenceAnalysis.status === 'RESTRICTED_BREACH' ? '🚨 Sovereign Maritime Incursion Alert' :
                 geofenceAnalysis.status === 'CAUTION' ? '⚠️ Border & Ecological Caution Active' :
                 '🛡️ Sovereign Maritime Boundary Clearance'}
              </span>
            </div>
            <span className={`px-2.5 py-0.5 rounded-md text-[10px] font-mono font-bold uppercase ${
              geofenceAnalysis.status === 'RESTRICTED_BREACH' ? 'bg-rose-600 text-white animate-pulse' :
              geofenceAnalysis.status === 'CAUTION' ? 'bg-amber-100 text-amber-900 border border-amber-300' :
              'bg-emerald-100 text-emerald-900 border border-emerald-300'
            }`}>
              {geofenceAnalysis.status}
            </span>
          </div>

          <p className="text-xs leading-relaxed font-medium text-slate-700">
            {geofenceAnalysis.activeAlerts.length > 0 
              ? geofenceAnalysis.activeAlerts[0].warningMessage 
              : `Vessel has clear operational waters. Operating point is ${geofenceAnalysis.nearestImbl?.distanceNm ?? '>15'} NM from the nearest International Maritime Boundary Line (${geofenceAnalysis.nearestImbl?.boundaryName.split('(')[0] || 'IMBL'}).`}
          </p>

          {/* Detailed Boundary Proximity Grid */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 pt-1 border-t border-slate-200 text-[11px] font-mono">
            {geofenceAnalysis.nearestImbl && (
              <div className="bg-white p-2.5 rounded-xl border border-slate-200 space-y-0.5 shadow-2xs">
                <div className="flex items-center justify-between text-slate-800 font-bold">
                  <span className="truncate max-w-[150px]">{geofenceAnalysis.nearestImbl.boundaryName.split('(')[0]}</span>
                  <span className={geofenceAnalysis.nearestImbl.hasCrossedBorder ? 'text-rose-600 font-black animate-pulse' : geofenceAnalysis.nearestImbl.distanceNm <= 3.0 ? 'text-rose-600 font-black' : geofenceAnalysis.nearestImbl.distanceNm <= 8.0 ? 'text-amber-600' : 'text-slate-700'}>
                    {geofenceAnalysis.nearestImbl.hasCrossedBorder ? `CROSSED (${geofenceAnalysis.nearestImbl.distanceNm} NM)` : `${geofenceAnalysis.nearestImbl.distanceNm} NM`}
                  </span>
                </div>
                <div className="text-[10px] text-slate-500 flex items-center justify-between">
                  <span>{geofenceAnalysis.nearestImbl.hasCrossedBorder ? 'Return Heading' : 'Bearing'}: {geofenceAnalysis.nearestImbl.bearingDeg ?? 0}°</span>
                  <span className={geofenceAnalysis.nearestImbl.hasCrossedBorder ? 'text-rose-600 font-bold' : 'text-sky-700'}>{geofenceAnalysis.nearestImbl.hasCrossedBorder ? 'BORDER BREACH' : geofenceAnalysis.nearestImbl.severity.replace('_', ' ')}</span>
                </div>
              </div>
            )}

            {geofenceAnalysis.nearestMpa && (
              <div className="bg-white p-2.5 rounded-xl border border-slate-200 space-y-0.5 shadow-2xs">
                <div className="flex items-center justify-between text-slate-800 font-bold">
                  <span className="truncate max-w-[150px]">{geofenceAnalysis.nearestMpa.boundaryName.split(' ')[0]} Sanctuary</span>
                  <span className={(geofenceAnalysis.nearestMpa.isInside || geofenceAnalysis.nearestMpa.distanceNm === 0) ? 'text-rose-600 font-black animate-pulse' : geofenceAnalysis.nearestMpa.distanceNm <= 3.0 ? 'text-amber-600' : 'text-emerald-600 font-bold'}>
                    {(geofenceAnalysis.nearestMpa.isInside || geofenceAnalysis.nearestMpa.distanceNm === 0)
                      ? `INSIDE (${geofenceAnalysis.nearestMpa.insideDepthNm ?? geofenceAnalysis.nearestMpa.distanceNm} NM)`
                      : `${geofenceAnalysis.nearestMpa.distanceNm} NM`}
                  </span>
                </div>
                <div className="text-[10px] text-slate-500 flex items-center justify-between">
                  <span>{(geofenceAnalysis.nearestMpa.isInside || geofenceAnalysis.nearestMpa.distanceNm === 0) ? `Escape Heading: ${geofenceAnalysis.nearestMpa.escapeBearingDeg ?? geofenceAnalysis.nearestMpa.bearingDeg ?? 0}°` : 'Ecological Buffer'}</span>
                  <span className={(geofenceAnalysis.nearestMpa.isInside || geofenceAnalysis.nearestMpa.distanceNm === 0) ? 'text-rose-600 font-bold' : 'text-emerald-700'}>
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
        <div className="bg-emerald-50/80 border border-emerald-200 rounded-2xl p-4 space-y-1.5 shadow-2xs">
          <div className="flex items-center space-x-1.5 font-bold text-emerald-800">
            <CheckCircle2 className="h-4 w-4 text-emerald-600" />
            <span>{dict.permittedVessels}</span>
          </div>
          <ul className="space-y-1 text-slate-700 text-[11px] pt-1">
            {risk.safeCraftTypes.length > 0 ? (
              risk.safeCraftTypes.map((craft, i) => (
                <li key={i} className="flex items-center space-x-1.5">
                  <span className="h-1.5 w-1.5 rounded-full bg-emerald-500 shrink-0"></span>
                  <span className="font-medium">{craft}</span>
                </li>
              ))
            ) : (
              <li className="text-slate-500 italic">{dict.noCraftsCleared}</li>
            )}
          </ul>
        </div>

        {/* Restricted / Embargoed Craft Types */}
        <div className="bg-rose-50/80 border border-rose-200 rounded-2xl p-4 space-y-1.5 shadow-2xs">
          <div className="flex items-center space-x-1.5 font-bold text-rose-800">
            <XCircle className="h-4 w-4 text-rose-600" />
            <span>{dict.restrictedVessels}</span>
          </div>
          <ul className="space-y-1 text-slate-700 text-[11px] pt-1">
            {risk.restrictedCraftTypes.length > 0 ? (
              risk.restrictedCraftTypes.map((craft, i) => (
                <li key={i} className="flex items-center space-x-1.5">
                  <span className="h-1.5 w-1.5 rounded-full bg-rose-500 shrink-0"></span>
                  <span className="font-medium">{craft}</span>
                </li>
              ))
            ) : (
              <li className="text-emerald-700 italic">{dict.noRestrictions}</li>
            )}
          </ul>
        </div>

      </div>

      {/* Actionable Safety Bulletins Checklist */}
      <div className="bg-slate-50 border border-slate-200 rounded-2xl p-4 space-y-2.5 shadow-2xs">
        <div className="text-xs font-bold text-slate-800 flex items-center justify-between">
          <span className="flex items-center gap-1.5">
            <FileText className="h-4 w-4 text-sky-600" />
            <span>{dict.recommendations}</span>
          </span>
          <span className="text-[10px] font-mono font-semibold text-slate-500">
            {dict.validUntil}: {new Date(risk.validUntil).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
          </span>
        </div>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 text-[11px] text-slate-700">
          {risk.actionableAdvisories.map((advisory, idx) => (
            <div key={idx} className="flex items-start space-x-2 bg-white p-2.5 rounded-xl border border-slate-200 shadow-2xs">
              <span className="text-sky-700 font-bold font-mono shrink-0">#{idx + 1}</span>
              <span className="leading-snug">{advisory}</span>
            </div>
          ))}
        </div>
      </div>

    </div>
  );
};
