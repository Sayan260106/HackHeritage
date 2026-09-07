import React from 'react';
import {
  Waves,
  Wind,
  Compass,
  Thermometer,
  Gauge,
  Eye,
  Droplets,
  Navigation2,
  Clock,
  Activity,
  ArrowUpRight,
  ShieldAlert,
  AlertCircle
} from 'lucide-react';
import { WeatherData, OceanData, SatelliteData, LanguageCode } from '../types';
import { MULTILINGUAL_DICTIONARY } from '../data/coastalData';
import { localizeSeaState } from '../utils/presentationLocalization';

interface MarineTelemetryProps {
  weather: WeatherData;
  ocean: OceanData;
  satellite: SatelliteData;
  language: LanguageCode;
}

export const MarineTelemetry: React.FC<MarineTelemetryProps> = ({
  weather,
  ocean,
  satellite,
  language
}) => {
  const dict = MULTILINGUAL_DICTIONARY[language] || MULTILINGUAL_DICTIONARY.en;

  // Angle difference between wind and swell direction (Wind-against-tide steepening check)
  const angleDiff = Math.abs((weather.windDirectionDeg - ocean.swellDirectionDeg + 360) % 360);
  const isWindAgainstSwell = angleDiff >= 135 && angleDiff <= 225 && weather.windSpeedKts > 12;

  // Percentage calculations for gauges (clamped to 0-100)
  const wavePct = Math.min(100, Math.max(0, (ocean.waveHeightMeters / 4.0) * 100));
  const windPct = Math.min(100, Math.max(0, (weather.windSpeedKts / 35.0) * 100));
  const swellPct = Math.min(100, Math.max(0, (ocean.swellPeriodSec / 20.0) * 100));
  const currentPct = Math.min(100, Math.max(0, (ocean.currentSpeedKts / 3.0) * 100));

  return (
    <div className="space-y-4">

      {/* Section Title */}
      <div className="flex items-center justify-between">
        <div className="flex items-center space-x-2">
          <div className="h-2 w-2 rounded-full bg-cyan-400 animate-ping" />
          <Activity className="h-4 w-4 text-cyan-400" />
          <h3 className="text-sm font-bold text-slate-100 uppercase tracking-wider font-mono">
            {dict.telemetryTitle || 'Live Telemetry & Vector Compass'}
          </h3>
        </div>
        <span className="text-[10px] font-mono text-slate-400 bg-slate-900/80 px-2 py-0.5 rounded border border-slate-800">
          Open-Meteo & Copernicus Feeds
        </span>
      </div>

      {/* Grid of Key Telemetry Cards + Compass Dial */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-3.5">

        {/* 4 Primary Metric Cards (Col Span 8) */}
        <div className="lg:col-span-8 grid grid-cols-2 sm:grid-cols-2 gap-4">

          {/* 1. Significant Wave Height */}
          <div className="bg-[#0b121f]/50 border border-slate-800/40 rounded-xl p-4 space-y-3 relative overflow-hidden group hover:bg-[#0b121f]/80 transition-all">
            <div className="flex items-center justify-between text-slate-400 text-xs">
              <span className="flex items-center gap-1.5 font-medium">
                <Waves className="h-4 w-4 text-cyan-500/80" />
                <span className="font-semibold text-slate-300 tracking-wide">{dict.significantWave || 'Wave Height (Hs)'}</span>
              </span>
              <span className="text-[10px] font-mono text-cyan-500/80 font-bold">{dict.max || 'Max'} {ocean.maxWaveHeightMeters}m</span>
            </div>
            <div className="flex items-baseline justify-between pt-1">
              <div className="flex items-baseline space-x-1.5">
                <span className="text-3xl font-bold text-white font-mono tracking-tight tabular-nums leading-none">
                  {ocean.waveHeightMeters}
                </span>
                <span className="text-xs font-medium text-slate-500">{dict.meters || 'meters'}</span>
              </div>
              <span className={`text-[10px] font-mono font-bold px-1.5 py-0.5 rounded border ${
                ocean.waveHeightMeters > 2.0
                  ? 'bg-rose-500/10 text-rose-400 border-rose-500/20'
                  : ocean.waveHeightMeters > 1.25
                    ? 'bg-amber-500/10 text-amber-400 border-amber-500/20'
                    : 'bg-emerald-500/10 text-emerald-400 border-emerald-500/20'
              }`}>
                {ocean.waveHeightMeters > 2.0 ? 'ROUGH' : ocean.waveHeightMeters > 1.25 ? 'MODERATE' : 'SLIGHT'}
              </span>
            </div>

            {/* Visual Gauge Bar */}
            <div className="w-full h-1 bg-slate-800/50 rounded-full overflow-hidden">
              <div
                className={`h-full transition-all duration-1000 ease-out ${
                  ocean.waveHeightMeters > 2.0 ? 'bg-rose-500' : ocean.waveHeightMeters > 1.25 ? 'bg-amber-400' : 'bg-cyan-500/80'
                }`}
                style={{ width: `${wavePct}%` }}
              />
            </div>

            <div className="text-[10px] uppercase tracking-widest text-slate-500 font-medium flex items-center justify-between pt-2">
              <span>{dict.period || 'Period'}: <strong className="text-slate-300 tabular-nums">{ocean.wavePeriodSec}s</strong></span>
              <span>{dict.direction || 'Heading'}: <strong className="text-slate-300 tabular-nums">{ocean.waveDirectionDeg}°</strong></span>
            </div>
          </div>

          {/* 2. Swell Wave Surge */}
          <div className="bg-[#0b121f]/50 border border-slate-800/40 rounded-xl p-4 space-y-3 relative overflow-hidden group hover:bg-[#0b121f]/80 transition-all">
            <div className="flex items-center justify-between text-slate-400 text-xs">
              <span className="flex items-center gap-1.5 font-medium">
                <ArrowUpRight className="h-4 w-4 text-indigo-400/80" />
                <span className="font-semibold text-slate-300 tracking-wide">{dict.swellPeriod || 'Swell Period'}</span>
              </span>
              <span className="text-[10px] font-mono text-indigo-400/80 font-bold tabular-nums">{ocean.swellHeightMeters}m {dict.swell || 'Swell'}</span>
            </div>
            <div className="flex items-baseline justify-between pt-1">
              <div className="flex items-baseline space-x-1.5">
                <span className="text-3xl font-bold text-white font-mono tracking-tight tabular-nums leading-none">
                  {ocean.swellPeriodSec}
                </span>
                <span className="text-xs font-medium text-slate-500">{dict.seconds || 'seconds'}</span>
              </div>
              <span className={`text-[10px] font-mono font-bold px-1.5 py-0.5 rounded border ${
                ocean.swellPeriodSec > 13 ? 'bg-rose-500/10 text-rose-400 border-rose-500/20' : 'bg-emerald-500/10 text-emerald-400 border-emerald-500/20'
              }`}>
                {ocean.swellPeriodSec > 13 ? (dict.highSurge || 'SURGE HAZARD') : (dict.stable || 'STABLE')}
              </span>
            </div>

            {/* Visual Gauge Bar */}
            <div className="w-full h-1 bg-slate-800/50 rounded-full overflow-hidden">
              <div
                className={`h-full transition-all duration-1000 ease-out ${ocean.swellPeriodSec > 13 ? 'bg-rose-500' : 'bg-indigo-400/80'}`}
                style={{ width: `${swellPct}%` }}
              />
            </div>

            <div className="text-[10px] uppercase tracking-widest text-slate-500 font-medium flex items-center justify-between pt-2">
              <span>{dict.direction || 'Heading'}: <strong className="text-slate-300 tabular-nums">{ocean.swellDirectionDeg}°</strong></span>
              <span className={ocean.swellPeriodSec > 13 ? 'text-rose-400 font-bold' : 'text-emerald-400/80'}>
                {ocean.swellPeriodSec > 13 ? (dict.breakerSurge || 'Long Swell Surge') : (dict.shortChop || 'Short Swell')}
              </span>
            </div>
          </div>

          {/* 3. Wind Speed & Gusts */}
          <div className="bg-[#0b121f]/50 border border-slate-800/40 rounded-xl p-4 space-y-3 relative overflow-hidden group hover:bg-[#0b121f]/80 transition-all">
            <div className="flex items-center justify-between text-slate-400 text-xs">
              <span className="flex items-center gap-1.5 font-medium">
                <Wind className="h-4 w-4 text-sky-400/80" />
                <span className="font-semibold text-slate-300 tracking-wide">{dict.windSpeed || 'Wind Velocity'}</span>
              </span>
              <span className="text-[10px] font-mono text-sky-400/80 font-bold tabular-nums">{weather.windDirectionCompass} ({weather.windDirectionDeg}°)</span>
            </div>
            <div className="flex items-baseline justify-between pt-1">
              <div className="flex items-baseline space-x-1.5">
                <span className="text-3xl font-bold text-white font-mono tracking-tight tabular-nums leading-none">
                  {weather.windSpeedKts}
                </span>
                <span className="text-xs font-medium text-slate-500">{dict.knots || 'knots'}</span>
              </div>
              <span className="text-[10px] font-mono text-amber-400 bg-amber-500/10 border border-amber-500/20 px-1.5 py-0.5 rounded font-bold tabular-nums">
                {dict.gusts || 'Gust'} {weather.windGustKts} kts
              </span>
            </div>

            {/* Visual Gauge Bar */}
            <div className="w-full h-1 bg-slate-800/50 rounded-full overflow-hidden">
              <div
                className={`h-full transition-all duration-1000 ease-out ${weather.windSpeedKts > 20 ? 'bg-rose-500' : weather.windSpeedKts > 12 ? 'bg-amber-400' : 'bg-sky-400/80'}`}
                style={{ width: `${windPct}%` }}
              />
            </div>

            <div className="text-[10px] uppercase tracking-widest text-slate-500 font-medium flex items-center justify-between pt-2">
              <span>Gust Factor: <strong className="text-amber-400 tabular-nums">{(weather.windGustKts / (weather.windSpeedKts || 1)).toFixed(1)}x</strong></span>
              <span>Beaufort Scale</span>
            </div>
          </div>

          {/* 4. Ocean Currents */}
          <div className="bg-[#0b121f]/50 border border-slate-800/40 rounded-xl p-4 space-y-3 relative overflow-hidden group hover:bg-[#0b121f]/80 transition-all">
            <div className="flex items-center justify-between text-slate-400 text-xs">
              <span className="flex items-center gap-1.5 font-medium">
                <Navigation2 className="h-4 w-4 text-teal-400/80" />
                <span className="font-semibold text-slate-300 tracking-wide">{dict.currentVelocity || 'Current Speed'}</span>
              </span>
              <span className="text-[10px] font-mono text-teal-400/80 font-bold tabular-nums">{ocean.currentDirectionDeg}° {dict.set || 'Set'}</span>
            </div>
            <div className="flex items-baseline justify-between pt-1">
              <div className="flex items-baseline space-x-1.5">
                <span className="text-3xl font-bold text-white font-mono tracking-tight tabular-nums leading-none">
                  {ocean.currentSpeedKts}
                </span>
                <span className="text-xs font-medium text-slate-500">{dict.knots || 'knots'}</span>
              </div>
              <span className="text-[10px] font-mono text-slate-300 bg-slate-800/50 border border-slate-700/50 px-1.5 py-0.5 rounded tabular-nums">
                {dict.tide || 'Tide'} {ocean.tideHeightMeters}m
              </span>
            </div>

            {/* Visual Gauge Bar */}
            <div className="w-full h-1 bg-slate-800/50 rounded-full overflow-hidden">
              <div
                className="h-full bg-teal-400/80 transition-all duration-1000 ease-out"
                style={{ width: `${currentPct}%` }}
              />
            </div>

            <div className="text-[10px] uppercase tracking-widest text-slate-500 font-medium flex items-center justify-between pt-2">
              <span>Phase: <strong className="text-slate-300">{localizeSeaState(ocean.tidePhase, language)}</strong></span>
              <span>Drift Vector</span>
            </div>
          </div>

        </div>

        {/* High-Tech Vector Compass Dial (Col Span 4) */}
        <div className="lg:col-span-4 bg-[#0b121f]/50 border border-slate-800/40 rounded-xl p-5 flex flex-col justify-between items-center relative overflow-hidden shadow-inner hover:bg-[#0b121f]/80 transition-all">
          <div className="w-full flex items-center justify-between text-[10px] font-mono uppercase tracking-widest text-slate-500 font-semibold mb-4">
            <span className="flex items-center gap-1.5">
              <Compass className="h-4 w-4 text-slate-400" />
              <span>Vector Dial</span>
            </span>
            <span className={`px-2 py-0.5 rounded border ${
              isWindAgainstSwell
                ? 'bg-rose-500/10 text-rose-400 border-rose-500/30 animate-pulse font-bold'
                : 'bg-slate-800/50 text-cyan-500/80 border-slate-700/50'
            }`}>
              {isWindAgainstSwell ? 'WIND-VS-SWELL' : 'CO-ALIGNED'}
            </span>
          </div>

          {/* Compass Visual Instrument */}
          <div className="relative w-40 h-40 flex items-center justify-center my-2">

            {/* Outer Compass Ring */}
            <div className="absolute inset-0 rounded-full border border-slate-800/80 bg-[#06090e]/80 shadow-[inset_0_4px_20px_rgba(0,0,0,0.5)] flex items-center justify-center">
              <div className="absolute top-2 text-[10px] font-mono font-bold text-slate-500">N</div>
              <div className="absolute right-2 text-[10px] font-mono font-bold text-slate-600">E</div>
              <div className="absolute bottom-2 text-[10px] font-mono font-bold text-slate-600">S</div>
              <div className="absolute left-2 text-[10px] font-mono font-bold text-slate-600">W</div>
            </div>

            {/* Inner Degree Tick Marks */}
            <svg className="w-full h-full transform -rotate-90 text-slate-700/40" viewBox="0 0 100 100">
              <circle cx="50" cy="50" r="42" fill="none" stroke="currentColor" strokeWidth="1" strokeDasharray="2 4" />
            </svg>

            {/* Wind Vector Pointer (Sky/Cyan Needle) */}
            <div
              className="absolute w-full h-full flex items-center justify-center transition-transform duration-1000 ease-out"
              style={{ transform: `rotate(${weather.windDirectionDeg}deg)` }}
            >
              <div className="h-16 w-1 bg-gradient-to-t from-transparent via-sky-500/80 to-sky-400 rounded-t -translate-y-4 relative shadow-sm">
                <div className="absolute -top-1 -left-1 text-sky-400">▲</div>
              </div>
            </div>

            {/* Swell Vector Pointer (Indigo/Rose Needle) */}
            <div
              className="absolute w-full h-full flex items-center justify-center transition-transform duration-1000 ease-out"
              style={{ transform: `rotate(${ocean.swellDirectionDeg}deg)` }}
            >
              <div className="h-12 w-[3px] bg-gradient-to-t from-transparent via-indigo-500/60 to-indigo-400/80 rounded-t -translate-y-3 relative opacity-80">
                <div className="absolute -top-1 -left-[3px] text-indigo-400/80 text-[10px]">●</div>
              </div>
            </div>

            {/* Central Hub Display */}
            <div className="absolute w-14 h-14 rounded-full bg-[#0b121f] border border-slate-700/50 flex flex-col items-center justify-center shadow-2xl">
              <span className="text-[11px] font-black text-slate-200 font-mono tracking-wider">{weather.windDirectionCompass}</span>
              <span className="text-[9px] font-mono text-slate-400">{weather.windDirectionDeg}°</span>
            </div>

          </div>

          {/* Compass Legend & Hazard Warning */}
          <div className="w-full space-y-2 mt-4">
            <div className="flex items-center justify-around text-[10px] font-mono text-slate-500 font-medium uppercase tracking-widest pt-3 border-t border-slate-800/40">
              <span className="flex items-center gap-1.5">
                <span className="h-2 w-2 rounded-full bg-sky-500/80"></span>
                <span>Wind ({weather.windDirectionDeg}°)</span>
              </span>
              <span className="flex items-center gap-1.5">
                <span className="h-2 w-2 rounded-full bg-indigo-500/80"></span>
                <span>Swell ({ocean.swellDirectionDeg}°)</span>
              </span>
            </div>
            {isWindAgainstSwell && (
              <p className="text-[10px] text-rose-400 bg-rose-500/10 p-2 rounded border border-rose-500/20 text-center font-mono leading-relaxed mt-2">
                ⚠️ Wind opposing swell heading! Risk of steep breaking waves.
              </p>
            )}
          </div>

        </div>

      </div>

      {/* Secondary Environmental Indicators */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
        
        {/* 1. Sea Surface Temp */}
        <div className="bg-[#0b121f]/50 border border-slate-800/40 rounded-xl p-4 flex flex-col justify-between space-y-3 hover:bg-[#0b121f]/80 transition-all min-w-0">
          <div className="flex items-center space-x-2 min-w-0">
            <div className="text-rose-500/80 shrink-0">
              <Thermometer className="h-4 w-4" />
            </div>
            <span className="text-[10px] font-bold text-slate-400 font-mono uppercase tracking-widest truncate">
              {dict.seaSurfaceTemp || 'Sea Surface Temp'}
            </span>
          </div>
          <div className="flex items-baseline justify-between">
            <div className="flex items-baseline space-x-1">
              <span className="text-2xl font-bold text-white font-mono tracking-tight leading-none">
                {ocean.seaSurfaceTemperatureC.toFixed(1)}
              </span>
              <span className="text-[10px] font-bold text-slate-500">°C</span>
            </div>
            <span className="text-[9px] font-mono text-cyan-400 font-bold bg-cyan-500/10 px-1.5 py-0.5 rounded border border-cyan-500/20 shrink-0">
              {typeof satellite.sstAnomalyC === 'number' ? `${satellite.sstAnomalyC > 0 ? '+' : ''}${satellite.sstAnomalyC.toFixed(1)}°C` : (dict.sstAnomaly || 'SST Live')}
            </span>
          </div>
        </div>

        {/* 2. Douglas Sea State */}
        <div className="bg-[#0b121f]/50 border border-slate-800/40 rounded-xl p-4 flex flex-col justify-between space-y-3 hover:bg-[#0b121f]/80 transition-all min-w-0">
          <div className="flex items-center space-x-2 min-w-0">
            <div className="text-cyan-500/80 shrink-0">
              <Compass className="h-4 w-4" />
            </div>
            <span className="text-[10px] font-bold text-slate-400 font-mono uppercase tracking-widest truncate">
              {dict.douglasSeaState || 'Douglas Sea State'}
            </span>
          </div>
          <div className="flex items-baseline justify-between">
            <div className="flex items-baseline space-x-1">
              <span className="text-[10px] text-slate-500 font-mono font-bold uppercase">{dict.scale || 'Scale'}</span>
              <span className="text-2xl font-bold text-white font-mono tracking-tight leading-none ml-1">
                {ocean.seaStateIndex}
              </span>
            </div>
            <span className="text-[9px] font-mono text-slate-300 font-bold bg-slate-800/50 px-1.5 py-0.5 rounded border border-slate-700/50 shrink-0 uppercase">
              {localizeSeaState(ocean.seaStateDescription.split(' ')[0], language)}
            </span>
          </div>
        </div>

        {/* 3. Visibility & Rain */}
        <div className="bg-[#0b121f]/50 border border-slate-800/40 rounded-xl p-4 flex flex-col justify-between space-y-3 hover:bg-[#0b121f]/80 transition-all min-w-0">
          <div className="flex items-center space-x-2 min-w-0">
            <div className="text-blue-500/80 shrink-0">
              <Eye className="h-4 w-4" />
            </div>
            <span className="text-[10px] font-bold text-slate-400 font-mono uppercase tracking-widest truncate">
              {dict.visibility || 'Visibility'}
            </span>
          </div>
          <div className="flex items-baseline justify-between">
            <div className="flex items-baseline space-x-1">
              <span className="text-2xl font-bold text-white font-mono tracking-tight leading-none">
                {weather.visibilityKm.toFixed(1)}
              </span>
              <span className="text-[10px] font-bold text-slate-500">km</span>
            </div>
            <span className="text-[9px] font-mono text-slate-400 font-bold bg-slate-800/50 px-1.5 py-0.5 rounded border border-slate-700/50 shrink-0">
              {weather.precipitationMm}mm {dict.rain || 'rain'}
            </span>
          </div>
        </div>

        {/* 4. Barometric Pressure */}
        <div className="bg-[#0b121f]/50 border border-slate-800/40 rounded-xl p-4 flex flex-col justify-between space-y-3 hover:bg-[#0b121f]/80 transition-all min-w-0">
          <div className="flex items-center space-x-2 min-w-0">
            <div className="text-purple-500/80 shrink-0">
              <Gauge className="h-4 w-4" />
            </div>
            <span className="text-[10px] font-bold text-slate-400 font-mono uppercase tracking-widest truncate">
              {dict.surfacePressure || 'Surface Pressure'}
            </span>
          </div>
          <div className="flex items-baseline justify-between">
            <div className="flex items-baseline space-x-1">
              <span className="text-2xl font-bold text-white font-mono tracking-tight leading-none">
                {weather.pressureHpa}
              </span>
              <span className="text-[10px] font-bold text-slate-500">hPa</span>
            </div>
            <span className="text-[9px] font-mono text-emerald-400/80 font-bold bg-emerald-500/10 px-1.5 py-0.5 rounded border border-emerald-500/20 shrink-0 uppercase">
              {dict.stable || 'Stable'}
            </span>
          </div>
        </div>

      </div>

    </div>
  );
};
