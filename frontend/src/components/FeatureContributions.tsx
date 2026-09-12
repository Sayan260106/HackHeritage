import React from 'react';
import { 
  BarChart3, 
  TrendingUp, 
  TrendingDown
} from 'lucide-react';
import { RiskPrediction, LanguageCode } from '../types';
import { MULTILINGUAL_DICTIONARY } from '../data/coastalData';
import { localizeFeatureName, localizeImpactLabel } from '../utils/presentationLocalization';

interface FeatureContributionsProps {
  risk: RiskPrediction;
  language: LanguageCode;
}

export const FeatureContributions: React.FC<FeatureContributionsProps> = ({ risk, language }) => {
  const dict = MULTILINGUAL_DICTIONARY[language] || MULTILINGUAL_DICTIONARY.en;
  return (
    <div className="bg-white border border-slate-200/90 rounded-2xl p-5 shadow-sm space-y-4">
      
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center space-x-2">
          <BarChart3 className="h-4 w-4 text-sky-600" />
          <h3 className="text-sm font-bold text-slate-800 uppercase tracking-wider font-mono">
            {dict.factors}
          </h3>
        </div>
        <span className="text-[11px] font-mono text-slate-600 bg-slate-50 px-2.5 py-1 rounded-lg border border-slate-200">
          SHAP-Calibrated Drivers • {risk.modelVersion}
        </span>
      </div>

      <p className="text-xs text-slate-600 leading-relaxed">
        The ORCA-X machine learning pipeline decomposes environmental observations into normalized feature vectors. 
        Positive impact weights elevate marine hazard probability, while negative weights act as operational stabilizing factors.
      </p>

      {/* Feature Waterfall / Bar Chart List */}
      <div className="space-y-3 pt-1">
        {risk.featureContributions.map((feat, idx) => {
          const isPositive = feat.riskWeight > 0;
          const absWeight = Math.min(100, Math.abs(feat.riskWeight * 100));

          const getImpactBadge = (impact: string) => {
            switch (impact) {
              case 'CRITICAL':
                return 'bg-red-50 text-red-700 border-red-200';
              case 'HIGH':
                return 'bg-rose-50 text-rose-700 border-rose-200';
              case 'MEDIUM':
                return 'bg-amber-50 text-amber-800 border-amber-200';
              case 'LOW':
              default:
                return 'bg-emerald-50 text-emerald-700 border-emerald-200';
            }
          };

          return (
            <div 
              key={idx} 
              className="bg-slate-50/80 border border-slate-200 rounded-xl p-3.5 space-y-2 hover:border-sky-300 hover:bg-white transition-all shadow-2xs"
            >
              {/* Top Row: Name, Value, Impact Badge */}
              <div className="flex items-center justify-between">
                <div className="flex items-center space-x-2">
                  {isPositive ? (
                    <TrendingUp className="h-4 w-4 text-rose-500 shrink-0" />
                  ) : (
                    <TrendingDown className="h-4 w-4 text-emerald-600 shrink-0" />
                  )}
                  <span className="font-bold text-xs text-slate-800">
                    {localizeFeatureName(feat.featureName, language)}
                  </span>
                  <span className="text-[11px] font-mono text-sky-700 font-semibold bg-white px-2 py-0.5 rounded border border-slate-200 shadow-2xs">
                    {feat.featureValue} {feat.unit}
                  </span>
                </div>

                <div className="flex items-center space-x-2">
                  <span className={`text-[10px] font-mono font-bold px-2 py-0.5 rounded border ${getImpactBadge(feat.impactLevel)}`}>
                    {localizeImpactLabel(feat.impactLevel, language)}
                  </span>
                  <span className={`text-xs font-mono font-bold ${isPositive ? 'text-rose-600' : 'text-emerald-700'}`}>
                    {isPositive ? `+${(feat.riskWeight * 100).toFixed(0)}%` : `${(feat.riskWeight * 100).toFixed(0)}%`}
                  </span>
                </div>
              </div>

              {/* Progress Weight Bar */}
              <div className="w-full bg-slate-200/80 h-2 rounded-full overflow-hidden flex">
                {isPositive ? (
                  <div 
                    className="h-full bg-gradient-to-r from-amber-400 to-rose-500 rounded-full transition-all duration-500"
                    style={{ width: `${absWeight}%` }}
                  />
                ) : (
                  <div 
                    className="h-full bg-gradient-to-r from-teal-400 to-emerald-500 rounded-full transition-all duration-500"
                    style={{ width: `${absWeight}%` }}
                  />
                )}
              </div>

              {/* Contextual Description */}
              <p className="text-[11px] text-slate-500 leading-snug">
                {feat.description}
              </p>
            </div>
          );
        })}
      </div>

    </div>
  );
};
