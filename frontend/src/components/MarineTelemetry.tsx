import React from 'react';
import {
  Waves,
  Wind,
  Compass,
  Thermometer,
  Gauge,
  Eye,
  Navigation2,
  Activity,
  ArrowUpRight,
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
          <div className="h-2 w-2 rounded-full bg-sky-500 animate-ping" />
          <Activity className="h-4 w-4 text-sky-600" />
          <h3 className="text-sm font-bold text-slate-800 uppercase tracking-wider font-mono">
            {dict.telemetryTitle || 'Live Telemetry & Vector Compass'}
          </h3>
        </div>
        <span className="text-[10px] font-mono text-slate-500 bg-white px-2 py-0.5 rounded border border-slate-200 shadow-2xs">
          Open-Meteo & Copernicus Feeds
        </span>
      </div>

      {/* Grid of Key Telemetry Cards + Compass Dial */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-3.5">

        {/* 4 Primary Metric Cards (Col Span 8) */}
        <div className="lg:col-span-8 grid grid-cols-2 sm:grid-cols-2 gap-4">

          {/* 1. Significant Wave Height */}
          <div className="bg-white border border-slate-200/90 rounded-xl p-4 space-y-3 relative overflow-hidden shadow-xs hover:shadow-md hover:border-sky-300 transition-all">
            <div className="flex items-center justify-between text-slate-500 text-xs">
              <span className="flex items-center gap-1.5 font-medium">
                <Waves className="h-4 w-4 text-sky-600" />
                <span className="font-semibold text-slate-800 tracking-wide">{dict.significantWave || 'Wave Height (Hs)'}</span>
              </span>
              <span className="text-[10px] font-mono text-sky-700 font-bold">{dict.max || 'Max'} {ocean.maxWaveHeightMeters}m</span>
            </div>
            <div className="flex items-baseline justify-between pt-1">
              <div className="flex items-baseline space-x-1.5">
                <span className="text-3xl font-bold text-slate-900 font-mono tracking-tight tabular-nums leading-none">
                  {ocean.waveHeightMeters}
                </span>
                <span className="text-xs font-medium text-slate-500">{dict.meters || 'meters'}</span>
              </div>
              <span className={`text-[10px] font-mono font-bold px-1.5 py-0.5 rounded border ${ocean.waveHeightMeters > 2.0
                  ? 'bg-rose-50 text-rose-700 border-rose-200'
                  : ocean.waveHeightMeters > 1.25
                    ? 'bg-amber-50 text-amber-800 border-amber-200'
                    : 'bg-emerald-50 text-emerald-700 border-emerald-200'
                }`}>
                {ocean.waveHeightMeters > 2.0 ? 'ROUGH' : ocean.waveHeightMeters > 1.25 ? 'MODERATE' : 'SLIGHT'}
              </span>
            </div>

            {/* Visual Gauge Bar */}
            <div className="w-full h-1.5 bg-slate-100 rounded-full overflow-hidden">
              <div
                className={`h-full transition-all duration-1000 ease-out ${ocean.waveHeightMeters > 2.0 ? 'bg-rose-500' : ocean.waveHeightMeters > 1.25 ? 'bg-amber-500' : 'bg-sky-500'
                  }`}
                style={{ width: `${wavePct}%` }}
              />
            </div>

            <div className="text-[10px] uppercase tracking-widest text-slate-500 font-medium flex items-center justify-between pt-2 border-t border-slate-100">
              <span>{dict.period || 'Period'}: <strong className="text-slate-800 tabular-nums">{ocean.wavePeriodSec}s</strong></span>
              <span>{dict.direction || 'Heading'}: <strong className="text-slate-800 tabular-nums">{ocean.waveDirectionDeg}°</strong></span>
            </div>
          </div>

          {/* 2. Swell Wave Surge */}
          <div className="bg-white border border-slate-200/90 rounded-xl p-4 space-y-3 relative overflow-hidden shadow-xs hover:shadow-md hover:border-sky-300 transition-all">
            <div className="flex items-center justify-between text-slate-500 text-xs">
              <span className="flex items-center gap-1.5 font-medium">
                <ArrowUpRight className="h-4 w-4 text-sky-600" />
                <span className="font-semibold text-slate-800 tracking-wide">{dict.swellPeriod || 'Swell Period'}</span>
              </span>
              <span className="text-[10px] font-mono text-sky-700 font-bold tabular-nums">{ocean.swellHeightMeters}m {dict.swell || 'Swell'}</span>
            </div>
            <div className="flex items-baseline justify-between pt-1">
              <div className="flex items-baseline space-x-1.5">
                <span className="text-3xl font-bold text-slate-900 font-mono tracking-tight tabular-nums leading-none">
                  {ocean.swellPeriodSec}
                </span>
                <span className="text-xs font-medium text-slate-500">{dict.seconds || 'seconds'}</span>
              </div>
              <span className={`text-[10px] font-mono font-bold px-1.5 py-0.5 rounded border ${ocean.swellPeriodSec > 13 ? 'bg-rose-50 text-rose-700 border-rose-200' : 'bg-emerald-50 text-emerald-700 border-emerald-200'
                }`}>
                {ocean.swellPeriodSec > 13 ? (dict.highSurge || 'SURGE HAZARD') : (dict.stable || 'STABLE')}
              </span>
            </div>

            {/* Visual Gauge Bar */}
            <div className="w-full h-1.5 bg-slate-100 rounded-full overflow-hidden">
              <div
                className={`h-full transition-all duration-1000 ease-out ${ocean.swellPeriodSec > 13 ? 'bg-rose-500' : 'bg-sky-600'}`}
                style={{ width: `${swellPct}%` }}
              />
            </div>

            <div className="text-[10px] uppercase tracking-widest text-slate-500 font-medium flex items-center justify-between pt-2 border-t border-slate-100">
              <span>{dict.direction || 'Heading'}: <strong className="text-slate-800 tabular-nums">{ocean.swellDirectionDeg}°</strong></span>
              <span className={ocean.swellPeriodSec > 13 ? 'text-rose-600 font-bold' : 'text-emerald-700'}>
                {ocean.swellPeriodSec > 13 ? (dict.breakerSurge || 'Long Swell Surge') : (dict.shortChop || 'Short Swell')}
              </span>
            </div>
          </div>

          {/* 3. Wind Speed & Gusts */}
          <div className="bg-white border border-slate-200/90 rounded-xl p-4 space-y-3 relative overflow-hidden shadow-xs hover:shadow-md hover:border-sky-300 transition-all">
            <div className="flex items-center justify-between text-slate-500 text-xs">
              <span className="flex items-center gap-1.5 font-medium">
                <Wind className="h-4 w-4 text-sky-600" />
                <span className="font-semibold text-slate-800 tracking-wide">{dict.windSpeed || 'Wind Velocity'}</span>
              </span>
              <span className="text-[10px] font-mono text-sky-700 font-bold tabular-nums">{weather.windDirectionCompass} ({weather.windDirectionDeg}°)</span>
            </div>
            <div className="flex flex-wrap items-center justify-between gap-1.5 pt-1">
              <div className="flex items-baseline space-x-1">
                <span className="text-2xl sm:text-3xl font-bold text-slate-900 font-mono tracking-tight tabular-nums leading-none">
                  {weather.windSpeedKts}
                </span>
                <span className="text-xs font-medium text-slate-500">{dict.knots || 'knots'}</span>
              </div>
              <span className="text-[10px] font-mono text-amber-800 bg-amber-50 border border-amber-200 px-1.5 py-0.5 rounded font-bold tabular-nums shrink-0">
                {dict.gusts || 'Gust'} {weather.windGustKts} kts
              </span>
            </div>

            {/* Visual Gauge Bar */}
            <div className="w-full h-1.5 bg-slate-100 rounded-full overflow-hidden">
              <div
                className={`h-full transition-all duration-1000 ease-out ${weather.windSpeedKts > 20 ? 'bg-rose-500' : weather.windSpeedKts > 12 ? 'bg-amber-500' : 'bg-sky-500'}`}
                style={{ width: `${windPct}%` }}
              />
            </div>

            <div className="text-[10px] uppercase tracking-widest text-slate-500 font-medium flex items-center justify-between pt-2 border-t border-slate-100">
              <span>Gust Factor: <strong className="text-amber-800 tabular-nums">{(weather.windGustKts / (weather.windSpeedKts || 1)).toFixed(1)}x</strong></span>
              <span>Beaufort Scale</span>
            </div>
          </div>

          {/* 4. Ocean Currents */}
          <div className="bg-white border border-slate-200/90 rounded-xl p-4 space-y-3 relative overflow-hidden shadow-xs hover:shadow-md hover:border-sky-300 transition-all">
            <div className="flex items-center justify-between text-slate-500 text-xs">
              <span className="flex items-center gap-1.5 font-medium min-w-0">
                <Navigation2 className="h-4 w-4 text-teal-600 shrink-0" />
                <span className="font-semibold text-slate-800 tracking-wide truncate">{dict.currentVelocity || 'Current Speed'}</span>
              </span>
              <span className="text-[10px] font-mono text-teal-700 font-bold tabular-nums shrink-0">{ocean.currentDirectionDeg}° {dict.set || 'Set'}</span>
            </div>
            <div className="flex flex-wrap items-center justify-between gap-1.5 pt-1">
              <div className="flex items-baseline space-x-1">
                <span className="text-2xl sm:text-3xl font-bold text-slate-900 font-mono tracking-tight tabular-nums leading-none">
                  {ocean.currentSpeedKts}
                </span>
                <span className="text-xs font-medium text-slate-500">{dict.knots || 'knots'}</span>
              </div>
              <span className="text-[10px] font-mono text-slate-700 bg-slate-100 border border-slate-200 px-1.5 py-0.5 rounded tabular-nums shrink-0">
                {dict.tide || 'Tide'} {ocean.tideHeightMeters}m
              </span>
            </div>

            {/* Visual Gauge Bar */}
            <div className="w-full h-1.5 bg-slate-100 rounded-full overflow-hidden">
              <div
                className="h-full bg-teal-500 transition-all duration-1000 ease-out"
                style={{ width: `${currentPct}%` }}
              />
            </div>

            <div className="text-[10px] uppercase tracking-widest text-slate-500 font-medium flex items-center justify-between pt-2 border-t border-slate-100">
              <span>Phase: <strong className="text-slate-800">{localizeSeaState(ocean.tidePhase, language)}</strong></span>
              <span>Flow: <strong className="text-slate-800">{ocean.currentDirectionDeg}° Set</strong></span>
            </div>
          </div>

        </div>

        {/* High-Tech Vector Compass Dial (Col Span 4) */}
        <div className="lg:col-span-4 bg-white border border-slate-200/90 rounded-xl p-5 flex flex-col justify-between items-center relative overflow-hidden shadow-xs hover:shadow-md hover:border-sky-300 transition-all">
          <div className="w-full flex items-center justify-between text-[10px] font-mono uppercase tracking-widest text-slate-500 font-semibold mb-4">
            <span className="flex items-center gap-1.5">
              <Compass className="h-4 w-4 text-sky-600" />
              <span>Vector Dial</span>
            </span>
            <span className={`px-2 py-0.5 rounded border ${isWindAgainstSwell
                ? 'bg-rose-50 text-rose-700 border-rose-200 animate-pulse font-bold'
                : 'bg-slate-100 text-sky-800 border-slate-200'
              }`}>
              {isWindAgainstSwell ? 'WIND-VS-SWELL' : 'CO-ALIGNED'}
            </span>
          </div>

          {/* Compass Visual Instrument */}
          <div className="relative w-40 h-40 flex items-center justify-center my-2">

            {/* Outer Compass Ring */}
            <div className="absolute inset-0 rounded-full border border-slate-200 bg-slate-50 shadow-inner flex items-center justify-center">
              <div className="absolute top-2 text-[10px] font-mono font-bold text-slate-700">N</div>
              <div className="absolute right-2 text-[10px] font-mono font-bold text-slate-500">E</div>
              <div className="absolute bottom-2 text-[10px] font-mono font-bold text-slate-500">S</div>
              <div className="absolute left-2 text-[10px] font-mono font-bold text-slate-500">W</div>
            </div>

            {/* Inner Degree Tick Marks */}
            <svg className="w-full h-full transform -rotate-90 text-slate-300" viewBox="0 0 100 100">
              <circle cx="50" cy="50" r="42" fill="none" stroke="currentColor" strokeWidth="1" strokeDasharray="2 4" />
            </svg>

            {/* Wind Vector Pointer (Sky/Cyan Needle) */}
            <div
              className="absolute w-full h-full flex items-center justify-center transition-transform duration-1000 ease-out"
              style={{ transform: `rotate(${weather.windDirectionDeg}deg)` }}
            >
              <div className="h-16 w-1 bg-gradient-to-t from-transparent via-sky-500 to-sky-600 rounded-t -translate-y-4 relative shadow-sm">
                <div className="absolute -top-1 -left-1 text-sky-600">▲</div>
              </div>
            </div>

            {/* Swell Vector Pointer (Teal Needle) */}
            <div
              className="absolute w-full h-full flex items-center justify-center transition-transform duration-1000 ease-out"
              style={{ transform: `rotate(${ocean.swellDirectionDeg}deg)` }}
            >
              <div className="h-12 w-[3px] bg-gradient-to-t from-transparent via-teal-500 to-teal-600 rounded-t -translate-y-3 relative opacity-90">
                <div className="absolute -top-1 -left-[3px] text-teal-600 text-[10px]">●</div>
              </div>
            </div>

            {/* Central Hub Display */}
            <div className="absolute w-14 h-14 rounded-full bg-white border border-slate-200 flex flex-col items-center justify-center shadow-md">
              <span className="text-[11px] font-black text-slate-800 font-mono tracking-wider">{weather.windDirectionCompass}</span>
              <span className="text-[9px] font-mono text-slate-500">{weather.windDirectionDeg}°</span>
            </div>

          </div>

          {/* Compass Legend & Hazard Warning */}
          <div className="w-full space-y-2 mt-4">
            <div className="flex items-center justify-around text-[10px] font-mono text-slate-500 font-medium uppercase tracking-widest pt-3 border-t border-slate-100">
              <span className="flex items-center gap-1.5">
                <span className="h-2 w-2 rounded-full bg-sky-500"></span>
                <span>Wind ({weather.windDirectionDeg}°)</span>
              </span>
              <span className="flex items-center gap-1.5">
                <span className="h-2 w-2 rounded-full bg-teal-500"></span>
                <span>Swell ({ocean.swellDirectionDeg}°)</span>
              </span>
            </div>
            {isWindAgainstSwell && (
              <p className="text-[10px] text-rose-800 bg-rose-50 p-2 rounded border border-rose-200 text-center font-mono leading-relaxed mt-2">
                ⚠️ Wind opposing swell heading! Risk of steep breaking waves.
              </p>
            )}
          </div>

        </div>

      </div>

      {/* Secondary Environmental Indicators */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">

        {/* 1. Sea Surface Temp */}
        <div className="bg-white border border-slate-200/90 rounded-xl p-4 flex flex-col justify-between space-y-3 shadow-xs hover:shadow-md hover:border-sky-300 transition-all min-w-0">
          <div className="flex items-center space-x-2 min-w-0">
            <div className="text-rose-500 shrink-0">
              <Thermometer className="h-4 w-4" />
            </div>
            <span className="text-xs font-bold text-slate-800 font-mono uppercase tracking-wider">
              {dict.seaSurfaceTemp || 'Sea Surface Temp'}
            </span>
          </div>
          <div className="flex flex-wrap items-end justify-between gap-2 pt-1">
            <div className="flex items-baseline space-x-1 shrink-0">
              <span className="text-2xl sm:text-3xl font-bold text-slate-900 font-mono tracking-tight leading-none">
                {ocean.seaSurfaceTemperatureC.toFixed(1)}
              </span>
              <span className="text-xs font-bold text-slate-500">°C</span>
            </div>
            <span className="text-xs font-mono text-sky-800 font-bold bg-sky-50 px-2 py-0.5 rounded border border-sky-200 shrink-0">
              {typeof satellite.sstAnomalyC === 'number' ? `${satellite.sstAnomalyC > 0 ? '+' : ''}${satellite.sstAnomalyC.toFixed(1)}°C` : 'SST Normal'}
            </span>
          </div>
        </div>

        {/* 2. Douglas Sea State */}
        <div className="bg-white border border-slate-200/90 rounded-xl p-4 flex flex-col justify-between space-y-3 shadow-xs hover:shadow-md hover:border-sky-300 transition-all min-w-0">
          <div className="flex items-center space-x-2 min-w-0">
            <div className="text-sky-600 shrink-0">
              <Compass className="h-4 w-4" />
            </div>
            <span className="text-xs font-bold text-slate-800 font-mono uppercase tracking-wider">
              {dict.douglasSeaState || 'Douglas Sea State'}
            </span>
          </div>
          <div className="flex flex-wrap items-end justify-between gap-2 pt-1">
            <div className="flex items-baseline space-x-1 shrink-0">
              <span className="text-xs text-slate-500 font-mono font-bold uppercase">{dict.scale || 'Scale'}</span>
              <span className="text-2xl sm:text-3xl font-bold text-slate-900 font-mono tracking-tight leading-none ml-1">
                {ocean.seaStateIndex}
              </span>
            </div>
            <span className="text-xs font-mono text-slate-700 font-bold bg-slate-100 px-2 py-0.5 rounded border border-slate-200 shrink-0 uppercase">
              {localizeSeaState(ocean.seaStateDescription.split(' ')[0], language)}
            </span>
          </div>
        </div>

        {/* 3. Visibility & Rain */}
        <div className="bg-white border border-slate-200/90 rounded-xl p-4 flex flex-col justify-between space-y-3 shadow-xs hover:shadow-md hover:border-sky-300 transition-all min-w-0">
          <div className="flex items-center space-x-2 min-w-0">
            <div className="text-sky-600 shrink-0">
              <Eye className="h-4 w-4" />
            </div>
            <span className="text-xs font-bold text-slate-800 font-mono uppercase tracking-wider">
              {dict.visibility || 'Visibility'}
            </span>
          </div>
          <div className="flex flex-wrap items-end justify-between gap-2 pt-1">
            <div className="flex items-baseline space-x-1 shrink-0">
              <span className="text-2xl sm:text-3xl font-bold text-slate-900 font-mono tracking-tight leading-none">
                {weather.visibilityKm.toFixed(1)}
              </span>
              <span className="text-xs font-bold text-slate-500">km</span>
            </div>
            <span className="text-xs font-mono text-slate-700 font-bold bg-slate-100 px-2 py-0.5 rounded border border-slate-200 shrink-0">
              {weather.precipitationMm}mm {dict.rain || 'rain'}
            </span>
          </div>
        </div>

        {/* 4. Barometric Pressure */}
        <div className="bg-white border border-slate-200/90 rounded-xl p-4 flex flex-col justify-between space-y-3 shadow-xs hover:shadow-md hover:border-sky-300 transition-all min-w-0">
          <div className="flex items-center space-x-2 min-w-0">
            <div className="text-teal-600 shrink-0">
              <Gauge className="h-4 w-4" />
            </div>
            <span className="text-xs font-bold text-slate-800 font-mono uppercase tracking-wider">
              {dict.surfacePressure || 'Surface Pressure'}
            </span>
          </div>
          <div className="flex flex-wrap items-end justify-between gap-2 pt-1">
            <div className="flex items-baseline space-x-1 shrink-0">
              <span className="text-2xl sm:text-3xl font-bold text-slate-900 font-mono tracking-tight leading-none">
                {weather.pressureHpa}
              </span>
              <span className="text-xs font-bold text-slate-500">hPa</span>
            </div>
            <span className="text-xs font-mono text-emerald-700 font-bold bg-emerald-50 px-2 py-0.5 rounded border border-emerald-200 shrink-0 uppercase">
              {dict.stable || 'Stable'}
            </span>
          </div>
        </div>

      </div>

    </div>
  );
};
