import React, { useState } from 'react';
import { 
  SlidersHorizontal, 
  RotateCcw, 
  Waves, 
  Wind, 
  Clock, 
  Navigation2
} from 'lucide-react';
import { LocationInfo, WeatherData, OceanData, SatelliteData, RiskPrediction, LanguageCode } from '../types';
import { calculateMarineRisk } from '../utils/marineRiskEngine';
import { MULTILINGUAL_DICTIONARY } from '../data/coastalData';
import { localizeRiskPrediction } from '../utils/marineRiskLocalization';

interface WhatIfSimulatorProps {
  location: LocationInfo;
  initialWeather: WeatherData;
  initialOcean: OceanData;
  initialSatellite: SatelliteData;
  language: LanguageCode;
}

export const WhatIfSimulator: React.FC<WhatIfSimulatorProps> = ({
  location,
  initialWeather,
  initialOcean,
  initialSatellite,
  language
}) => {
  const dict = MULTILINGUAL_DICTIONARY[language] || MULTILINGUAL_DICTIONARY.en;
  // Simulator State
  const [simWaveHeight, setSimWaveHeight] = useState<number>(initialOcean.waveHeightMeters);
  const [simSwellPeriod, setSimSwellPeriod] = useState<number>(initialOcean.swellPeriodSec);
  const [simWindSpeed, setSimWindSpeed] = useState<number>(initialWeather.windSpeedKts);
  const [simWindGust, setSimWindGust] = useState<number>(initialWeather.windGustKts);
  const [simCurrent, setSimCurrent] = useState<number>(initialOcean.currentSpeedKts);
  const [simVisibility, setSimVisibility] = useState<number>(initialWeather.visibilityKm);

  // Compute simulated risk dynamically using the same ML engine
  const simulatedWeather: WeatherData = {
    ...initialWeather,
    windSpeedKts: simWindSpeed,
    windGustKts: simWindGust,
    visibilityKm: simVisibility
  };

  const simulatedOcean: OceanData = {
    ...initialOcean,
    waveHeightMeters: simWaveHeight,
    maxWaveHeightMeters: Number((simWaveHeight * 1.6).toFixed(2)),
    swellPeriodSec: simSwellPeriod,
    currentSpeedKts: simCurrent
  };

  const rawSimRisk: RiskPrediction = calculateMarineRisk(
    simulatedWeather,
    simulatedOcean,
    initialSatellite,
    location
  );
  const simRisk = localizeRiskPrediction(rawSimRisk, simulatedWeather, simulatedOcean, language);

  const resetToBaseline = () => {
    setSimWaveHeight(initialOcean.waveHeightMeters);
    setSimSwellPeriod(initialOcean.swellPeriodSec);
    setSimWindSpeed(initialWeather.windSpeedKts);
    setSimWindGust(initialWeather.windGustKts);
    setSimCurrent(initialOcean.currentSpeedKts);
    setSimVisibility(initialWeather.visibilityKm);
  };

  const applyPreset = (preset: {
    wave: number;
    swell: number;
    wind: number;
    gust: number;
    current: number;
    visibility: number;
  }) => {
    setSimWaveHeight(preset.wave);
    setSimSwellPeriod(preset.swell);
    setSimWindSpeed(preset.wind);
    setSimWindGust(preset.gust);
    setSimCurrent(preset.current);
    setSimVisibility(preset.visibility);
  };

  const PRESETS = [
    {
      label: '🌊 Monsoon Swell Surge',
      desc: '3.8m waves • 28 kts wind',
      values: { wave: 3.8, swell: 14, wind: 28, gust: 42, current: 2.1, visibility: 4.5 },
    },
    {
      label: '🌪️ Cyclone Depression',
      desc: '4.5m waves • 35 kts storm',
      values: { wave: 4.5, swell: 16, wind: 35, gust: 55, current: 2.8, visibility: 2.0 },
    },
    {
      label: '⚡ Severe Squall & Fog',
      desc: '2.4m waves • 1.2 km fog',
      values: { wave: 2.4, swell: 11, wind: 24, gust: 38, current: 1.4, visibility: 1.2 },
    },
    {
      label: '☀️ Calm Trawling Window',
      desc: '0.6m waves • 6 kts calm',
      values: { wave: 0.6, swell: 7, wind: 6, gust: 9, current: 0.4, visibility: 12.0 },
    },
  ];

  // Theme for simulated risk
  const getTheme = (level: string) => {
    switch (level) {
      case 'LOW':
        return { color: 'text-emerald-700', bg: 'bg-emerald-50 text-emerald-700 border-emerald-300', bar: 'from-emerald-400 to-teal-500' };
      case 'MODERATE':
        return { color: 'text-amber-700', bg: 'bg-amber-50 text-amber-800 border-amber-300', bar: 'from-amber-400 to-amber-500' };
      case 'HIGH':
        return { color: 'text-rose-700', bg: 'bg-rose-50 text-rose-700 border-rose-300', bar: 'from-orange-400 to-rose-500' };
      case 'EXTREME':
      default:
        return { color: 'text-red-700', bg: 'bg-red-50 text-red-700 border-red-300', bar: 'from-rose-500 to-red-600' };
    }
  };

  const theme = getTheme(simRisk.riskLevel);

  return (
    <div className="bg-white border border-slate-200/90 rounded-2xl p-5 shadow-sm space-y-5 text-slate-800">
      
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center space-x-2">
          <SlidersHorizontal className="h-4 w-4 text-sky-600" />
          <h3 className="text-sm font-bold text-slate-800 uppercase tracking-wider font-mono">
            {dict.simulatorTitle}
          </h3>
        </div>
        <button
          onClick={resetToBaseline}
          className="flex items-center space-x-1 text-xs font-semibold text-slate-600 hover:text-slate-900 bg-slate-50 hover:bg-slate-100 px-2.5 py-1 rounded-lg border border-slate-200 transition-all cursor-pointer shadow-2xs"
        >
          <RotateCcw className="h-3 w-3 text-sky-600" />
          <span>{dict.resetLiveFeed}</span>
        </button>
      </div>

      <p className="text-xs text-slate-600 leading-relaxed">
        Simulate severe weather onset or calm conditions. Adjust parameters below or pick a preset to observe real-time recalculation of the calibrated XGBoost marine risk score and vessel permissions.
      </p>

      {/* Quick Scenario Presets */}
      <div className="space-y-1.5">
        <span className="text-[10px] font-mono uppercase tracking-wider text-slate-500 font-bold">
          Quick Operational Presets:
        </span>
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
          {PRESETS.map((p, idx) => (
            <button
              key={idx}
              onClick={() => applyPreset(p.values)}
              className="px-3 py-2 rounded-xl border border-slate-200 bg-slate-50/80 hover:bg-sky-50 hover:border-sky-300 transition-all text-left group cursor-pointer shadow-2xs"
            >
              <div className="text-xs font-bold text-slate-800 group-hover:text-sky-700 transition-colors">
                {p.label}
              </div>
              <div className="text-[10px] text-slate-500 font-mono mt-0.5">
                {p.desc}
              </div>
            </button>
          ))}
        </div>
      </div>

      {/* Grid: Sliders on Left, Live Outcome on Right */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-5">
        
        {/* Controls (7 Cols) */}
        <div className="lg:col-span-7 space-y-4 bg-slate-50/70 p-4 rounded-xl border border-slate-200 shadow-2xs">
          
          {/* Wave Height Slider */}
          <div className="space-y-1.5">
            <div className="flex justify-between text-xs font-mono">
              <span className="text-slate-700 font-semibold flex items-center gap-1">
                <Waves className="h-3.5 w-3.5 text-sky-600" />
                <span>{dict.significantWave}</span>
              </span>
              <span className="font-bold text-sky-700">{simWaveHeight.toFixed(1)} meters</span>
            </div>
            <input
              type="range"
              min="0.2"
              max="5.5"
              step="0.1"
              value={simWaveHeight}
              onChange={(e) => setSimWaveHeight(parseFloat(e.target.value))}
              className="w-full h-1.5 bg-slate-200 rounded-lg appearance-none cursor-pointer accent-sky-600"
            />
            <div className="flex justify-between text-[10px] text-slate-500 font-mono">
              <span>0.2m ({dict.calm})</span>
              <span>1.8m ({dict.warning})</span>
              <span>3.5m+ ({dict.severe})</span>
            </div>
          </div>

          {/* Swell Wave Period */}
          <div className="space-y-1.5">
            <div className="flex justify-between text-xs font-mono">
              <span className="text-slate-700 font-semibold flex items-center gap-1">
                <Clock className="h-3.5 w-3.5 text-sky-600" />
                <span>{dict.swellPeriod}</span>
              </span>
              <span className="font-bold text-sky-700">{simSwellPeriod.toFixed(0)} seconds</span>
            </div>
            <input
              type="range"
              min="4"
              max="20"
              step="1"
              value={simSwellPeriod}
              onChange={(e) => setSimSwellPeriod(parseInt(e.target.value))}
              className="w-full h-1.5 bg-slate-200 rounded-lg appearance-none cursor-pointer accent-sky-600"
            />
            <div className="flex justify-between text-[10px] text-slate-500 font-mono">
              <span>5s ({dict.shortChop})</span>
              <span>13s+ ({dict.breakerSurge})</span>
              <span>20s</span>
            </div>
          </div>

          {/* Wind Speed & Gusts */}
          <div className="space-y-1.5">
            <div className="flex justify-between text-xs font-mono">
              <span className="text-slate-700 font-semibold flex items-center gap-1">
                <Wind className="h-3.5 w-3.5 text-sky-600" />
                <span>{dict.windGusts}</span>
              </span>
              <span className="font-bold text-sky-700">{simWindSpeed.toFixed(0)} kts (Gust {simWindGust.toFixed(0)})</span>
            </div>
            <input
              type="range"
              min="2"
              max="50"
              step="1"
              value={simWindSpeed}
              onChange={(e) => {
                const spd = parseInt(e.target.value);
                setSimWindSpeed(spd);
                setSimWindGust(Math.round(spd * 1.4));
              }}
              className="w-full h-1.5 bg-slate-200 rounded-lg appearance-none cursor-pointer accent-sky-600"
            />
            <div className="flex justify-between text-[10px] text-slate-500 font-mono">
              <span>5 kts ({dict.gentle})</span>
              <span>22 kts ({dict.fresh})</span>
              <span>35 kts+ ({dict.gale})</span>
            </div>
          </div>

          {/* Ocean Currents */}
          <div className="space-y-1.5">
            <div className="flex justify-between text-xs font-mono">
              <span className="text-slate-700 font-semibold flex items-center gap-1">
                <Navigation2 className="h-3.5 w-3.5 text-teal-600" />
                <span>{dict.tidalCurrent}</span>
              </span>
              <span className="font-bold text-teal-700">{simCurrent.toFixed(1)} knots</span>
            </div>
            <input
              type="range"
              min="0.2"
              max="4.5"
              step="0.1"
              value={simCurrent}
              onChange={(e) => setSimCurrent(parseFloat(e.target.value))}
              className="w-full h-1.5 bg-slate-200 rounded-lg appearance-none cursor-pointer accent-teal-600"
            />
            <div className="flex justify-between text-[10px] text-slate-500 font-mono">
              <span>0.5 kts ({dict.mild})</span>
              <span>2.0 kts ({dict.strongShear})</span>
              <span>4.0 kts</span>
            </div>
          </div>

        </div>

        {/* Real-time Dynamic Outcome Card (5 Cols) */}
        <div className="lg:col-span-5 bg-white p-4 rounded-xl border border-slate-200 shadow-sm space-y-3 flex flex-col justify-between">
          
          <div className="space-y-3">
            <div className="flex items-center justify-between border-b border-slate-100 pb-2">
              <span className="text-xs font-bold text-slate-800 font-mono uppercase">
                Simulated Risk Output
              </span>
              <span className={`px-2.5 py-0.5 rounded-md text-xs font-bold uppercase border ${theme.bg}`}>
                {simRisk.riskLevel}
              </span>
            </div>

            {/* Score Progress Gauge */}
            <div className="space-y-1">
              <div className="flex justify-between text-xs font-mono">
                <span className="text-slate-500">{dict.calculatedScore}</span>
                <span className={`font-black text-base ${theme.color}`}>{simRisk.riskScore} / 100</span>
              </div>
              <div className="w-full bg-slate-100 h-3 rounded-full overflow-hidden">
                <div 
                  className={`h-full bg-gradient-to-r ${theme.bar} rounded-full transition-all duration-300`}
                  style={{ width: `${simRisk.riskScore}%` }}
                />
              </div>
            </div>

            {/* Simulated Recommendation */}
            <div className="space-y-1 bg-slate-50 p-2.5 rounded-lg border border-slate-200 shadow-2xs">
              <div className="text-[11px] font-bold text-slate-800">
                Simulated Directive:
              </div>
              <p className="text-xs text-slate-600 leading-snug">
                {simRisk.primaryRecommendation}
              </p>
            </div>

            {/* 2D Hazard Envelope Matrix Grid */}
            <div className="space-y-1.5 pt-2 border-t border-slate-100">
              <div className="flex items-center justify-between text-[10px] font-mono text-slate-500 font-semibold">
                <span>Hs vs Wind Hazard Matrix</span>
                <span className="text-sky-700">● Active Position</span>
              </div>
              <div className="grid grid-cols-5 gap-1 text-[9px] font-mono text-center">
                {/* Wave rows from high to low */}
                {[3.5, 2.5, 1.8, 1.2, 0.6].map((waveThreshold) => (
                  <React.Fragment key={waveThreshold}>
                    {[8, 14, 20, 26, 32].map((windThreshold) => {
                      const isCurrentCell = 
                        Math.abs(simWaveHeight - waveThreshold) < 0.6 && 
                        Math.abs(simWindSpeed - windThreshold) < 4;

                      const cellRisk = 
                        waveThreshold > 3.0 || windThreshold > 28 ? 'EXTREME' :
                        waveThreshold > 2.0 || windThreshold > 20 ? 'HIGH' :
                        waveThreshold > 1.3 || windThreshold > 12 ? 'MODERATE' : 'LOW';

                      const cellBg = cellRisk === 'EXTREME' ? 'bg-red-50 text-red-700 border-red-200' :
                        cellRisk === 'HIGH' ? 'bg-rose-50 text-rose-700 border-rose-200' :
                        cellRisk === 'MODERATE' ? 'bg-amber-50 text-amber-800 border-amber-200' :
                        'bg-emerald-50 text-emerald-700 border-emerald-200';

                      return (
                        <div 
                          key={`${waveThreshold}-${windThreshold}`}
                          className={`p-1 rounded border transition-all ${cellBg} ${isCurrentCell ? 'ring-2 ring-sky-600 ring-offset-1 ring-offset-white font-bold scale-105 z-10' : 'opacity-80'}`}
                          title={`Hs: ~${waveThreshold}m | Wind: ~${windThreshold}kts`}
                        >
                          {waveThreshold}m
                        </div>
                      );
                    })}
                  </React.Fragment>
                ))}
              </div>
            </div>
          </div>

          <div className="text-[11px] font-mono text-slate-500 pt-1 border-t border-slate-100 flex items-center justify-between">
            <span>Model: {simRisk.modelVersion}</span>
            <span>Realtime Safety Curve</span>
          </div>

        </div>

      </div>

    </div>
  );
};
