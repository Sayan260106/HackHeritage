import React from 'react';
import { 
  BarChart3, 
  TrendingUp, 
  TrendingDown, 
  AlertCircle, 
  Info, 
  Layers, 
  CheckCircle,
  HelpCircle
} from 'lucide-react';
import { FeatureContribution, RiskPrediction, LanguageCode } from '../types';
import { MULTILINGUAL_DICTIONARY } from '../data/coastalData';
import { localizeFeatureName, localizeImpactLabel } from '../utils/presentationLocalization';

interface FeatureContributionsProps {
  risk: RiskPrediction;
  language: LanguageCode;
}

export const FeatureContributions: React.FC<FeatureContributionsProps> = ({ risk, language }) => {
  const dict = MULTILINGUAL_DICTIONARY[language] || MULTILINGUAL_DICTIONARY.en;
  return (
    <div className="bg-slate-900/90 border border-slate-800 rounded-2xl p-5 shadow-xl space-y-4">
      
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center space-x-2">
          <BarChart3 className="h-4 w-4 text-cyan-400" />
          <h3 className="text-sm font-bold text-slate-100 uppercase tracking-wider font-mono">
            {dict.factors}
          </h3>
        </div>
        <span className="text-[11px] font-mono text-slate-400 bg-slate-950 px-2.5 py-1 rounded-lg border border-slate-800">
          SHAP-Calibrated Drivers • {risk.modelVersion}
        </span>
      </div>

      <p className="text-xs text-slate-300 leading-relaxed">
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
                return 'bg-red-500/20 text-red-400 border-red-500/40';
              case 'HIGH':
                return 'bg-rose-500/20 text-rose-400 border-rose-500/40';
              case 'MEDIUM':
                return 'bg-amber-500/20 text-amber-400 border-amber-500/40';
              case 'LOW':
              default:
                return 'bg-emerald-500/20 text-emerald-400 border-emerald-500/40';
            }
          };

          return (
            <div 
              key={idx} 
              className="bg-slate-950/70 border border-slate-800/80 rounded-xl p-3 space-y-2 hover:border-slate-700 transition-all"
            >
              {/* Top Row: Name, Value, Impact Badge */}
              <div className="flex items-center justify-between">
                <div className="flex items-center space-x-2">
                  {isPositive ? (
                    <TrendingUp className="h-4 w-4 text-rose-400 shrink-0" />
                  ) : (
                    <TrendingDown className="h-4 w-4 text-emerald-400 shrink-0" />
                  )}
                  <span className="font-semibold text-xs text-slate-200">
                    {localizeFeatureName(feat.featureName, language)}
                  </span>
                  <span className="text-[11px] font-mono text-cyan-400 bg-slate-900 px-1.5 py-0.5 rounded border border-slate-800">
                    {feat.featureValue} {feat.unit}
                  </span>
                </div>

                <div className="flex items-center space-x-2">
                  <span className={`text-[10px] font-mono font-bold px-2 py-0.5 rounded border ${getImpactBadge(feat.impactLevel)}`}>
                    {localizeImpactLabel(feat.impactLevel, language)}
                  </span>
                  <span className="text-xs font-mono font-bold text-slate-300">
                    {isPositive ? `+${(feat.riskWeight * 100).toFixed(0)}%` : `${(feat.riskWeight * 100).toFixed(0)}%`}
                  </span>
                </div>
              </div>

              {/* Progress Weight Bar */}
              <div className="w-full bg-slate-900 h-2 rounded-full overflow-hidden flex">
                {isPositive ? (
                  <div 
                    className="h-full bg-gradient-to-r from-amber-500 to-rose-500 rounded-full transition-all duration-500"
                    style={{ width: `${absWeight}%` }}
                  />
                ) : (
                  <div 
                    className="h-full bg-gradient-to-r from-teal-500 to-emerald-500 rounded-full transition-all duration-500"
                    style={{ width: `${absWeight}%` }}
                  />
                )}
              </div>

              {/* Contextual Description */}
              <p className="text-[11px] text-slate-400 leading-snug">
                {feat.description}
              </p>
            </div>
          );
        })}
      </div>

    </div>
  );
};
