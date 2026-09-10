import React, { useState } from 'react';
import { 
  SlidersHorizontal, 
  RotateCcw, 
  Play, 
  ShieldAlert, 
  ShieldCheck, 
  AlertTriangle, 
  Waves, 
  Wind, 
  Clock, 
  Navigation2,
  Cpu
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

  // Theme for simulated risk
  const getTheme = (level: string) => {
    switch (level) {
      case 'LOW':
        return { color: 'text-emerald-400', bg: 'bg-emerald-500/20 border-emerald-500/50', bar: 'from-emerald-500 to-teal-400' };
      case 'MODERATE':
        return { color: 'text-amber-400', bg: 'bg-amber-500/20 border-amber-500/50', bar: 'from-amber-500 to-yellow-400' };
      case 'HIGH':
        return { color: 'text-rose-400', bg: 'bg-rose-500/20 border-rose-500/50', bar: 'from-rose-500 to-orange-400' };
      case 'EXTREME':
      default:
        return { color: 'text-red-400', bg: 'bg-red-500/20 border-red-500/60', bar: 'from-red-600 to-rose-600' };
    }
  };

  const theme = getTheme(simRisk.riskLevel);

  return (
    <div className="bg-slate-900/90 border border-slate-800 rounded-2xl p-5 shadow-xl space-y-5">
      
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center space-x-2">
          <SlidersHorizontal className="h-4 w-4 text-cyan-400" />
          <h3 className="text-sm font-bold text-slate-100 uppercase tracking-wider font-mono">
            {dict.simulatorTitle}
          </h3>
        </div>
        <button
          onClick={resetToBaseline}
          className="flex items-center space-x-1 text-xs font-semibold text-slate-400 hover:text-white bg-slate-950 px-2.5 py-1 rounded-lg border border-slate-800 hover:bg-slate-800 transition-all"
        >
          <RotateCcw className="h-3 w-3" />
          <span>{dict.resetLiveFeed}</span>
        </button>
      </div>

      <p className="text-xs text-slate-300">
        Simulate severe weather onset or calm conditions. Adjust parameters below to observe real-time recalculation of the calibrated XGBoost marine risk score and vessel permissions.
      </p>

      {/* Grid: Sliders on Left, Live Outcome on Right */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-5">
        
        {/* Controls (7 Cols) */}
        <div className="lg:col-span-7 space-y-4 bg-slate-950/70 p-4 rounded-xl border border-slate-800">
          
          {/* Wave Height Slider */}
          <div className="space-y-1.5">
            <div className="flex justify-between text-xs font-mono">
              <span className="text-slate-300 flex items-center gap-1">
                <Waves className="h-3.5 w-3.5 text-cyan-400" />
                <span>{dict.significantWave}</span>
              </span>
              <span className="font-bold text-cyan-400">{simWaveHeight.toFixed(1)} meters</span>
            </div>
            <input
              type="range"
              min="0.2"
              max="5.5"
              step="0.1"
              value={simWaveHeight}
              onChange={(e) => setSimWaveHeight(parseFloat(e.target.value))}
              className="w-full h-1.5 bg-slate-800 rounded-lg appearance-none cursor-pointer accent-cyan-400"
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
              <span className="text-slate-300 flex items-center gap-1">
                <Clock className="h-3.5 w-3.5 text-indigo-400" />
                <span>{dict.swellPeriod}</span>
              </span>
              <span className="font-bold text-indigo-400">{simSwellPeriod.toFixed(0)} seconds</span>
            </div>
            <input
              type="range"
              min="4"
              max="20"
              step="1"
              value={simSwellPeriod}
              onChange={(e) => setSimSwellPeriod(parseInt(e.target.value))}
              className="w-full h-1.5 bg-slate-800 rounded-lg appearance-none cursor-pointer accent-indigo-400"
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
              <span className="text-slate-300 flex items-center gap-1">
                <Wind className="h-3.5 w-3.5 text-sky-400" />
                <span>{dict.windGusts}</span>
              </span>
              <span className="font-bold text-sky-400">{simWindSpeed.toFixed(0)} kts (Gust {simWindGust.toFixed(0)})</span>
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
              className="w-full h-1.5 bg-slate-800 rounded-lg appearance-none cursor-pointer accent-sky-400"
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
              <span className="text-slate-300 flex items-center gap-1">
                <Navigation2 className="h-3.5 w-3.5 text-teal-400" />
                <span>{dict.tidalCurrent}</span>
              </span>
              <span className="font-bold text-teal-400">{simCurrent.toFixed(1)} knots</span>
            </div>
            <input
              type="range"
              min="0.2"
              max="4.5"
              step="0.1"
              value={simCurrent}
              onChange={(e) => setSimCurrent(parseFloat(e.target.value))}
              className="w-full h-1.5 bg-slate-800 rounded-lg appearance-none cursor-pointer accent-teal-400"
            />
            <div className="flex justify-between text-[10px] text-slate-500 font-mono">
              <span>0.5 kts ({dict.mild})</span>
              <span>2.0 kts ({dict.strongShear})</span>
              <span>4.0 kts</span>
            </div>
          </div>

        </div>

        {/* Real-time Dynamic Outcome Card (5 Cols) */}
        <div className="lg:col-span-5 bg-slate-950 p-4 rounded-xl border border-slate-800 space-y-3 flex flex-col justify-between">
          
          <div className="space-y-3">
            <div className="flex items-center justify-between border-b border-slate-800 pb-2">
              <span className="text-xs font-bold text-slate-300 font-mono uppercase">
                Simulated Risk Output
              </span>
              <span className={`px-2.5 py-0.5 rounded-md text-xs font-extrabold uppercase border ${theme.bg}`}>
                {simRisk.riskLevel}
              </span>
            </div>

            {/* Score Progress Gauge */}
            <div className="space-y-1">
              <div className="flex justify-between text-xs font-mono">
                <span className="text-slate-400">{dict.calculatedScore}</span>
                <span className={`font-black text-base ${theme.color}`}>{simRisk.riskScore} / 100</span>
              </div>
              <div className="w-full bg-slate-900 h-3 rounded-full overflow-hidden">
                <div 
                  className={`h-full bg-gradient-to-r ${theme.bar} rounded-full transition-all duration-300`}
                  style={{ width: `${simRisk.riskScore}%` }}
                />
              </div>
            </div>

            {/* Simulated Recommendation */}
            <div className="space-y-1 bg-slate-900/60 p-2.5 rounded-lg border border-slate-800/80">
              <div className="text-[11px] font-bold text-slate-200">
                Simulated Directive:
              </div>
              <p className="text-xs text-slate-300 leading-snug">
                {simRisk.primaryRecommendation}
              </p>
            </div>

            {/* 2D Hazard Envelope Matrix Grid */}
            <div className="space-y-1.5 pt-2 border-t border-slate-800">
              <div className="flex items-center justify-between text-[10px] font-mono text-slate-400">
                <span>Hs vs Wind Hazard Matrix</span>
                <span className="text-cyan-400">● Active Position</span>
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

                      const cellBg = cellRisk === 'EXTREME' ? 'bg-red-950/80 text-red-300 border-red-800/60' :
                        cellRisk === 'HIGH' ? 'bg-rose-950/80 text-rose-300 border-rose-800/60' :
                        cellRisk === 'MODERATE' ? 'bg-amber-950/80 text-amber-300 border-amber-800/60' :
                        'bg-emerald-950/80 text-emerald-300 border-emerald-800/60';

                      return (
                        <div 
                          key={`${waveThreshold}-${windThreshold}`}
                          className={`p-1 rounded border transition-all ${cellBg} ${isCurrentCell ? 'ring-2 ring-cyan-400 ring-offset-1 ring-offset-slate-950 font-bold scale-105 z-10' : 'opacity-75'}`}
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

          <div className="text-[11px] font-mono text-slate-500 pt-1 border-t border-slate-800 flex items-center justify-between">
            <span>Model: {simRisk.modelVersion}</span>
            <span>Realtime Safety Curve</span>
          </div>

        </div>

      </div>

    </div>
  );
};
