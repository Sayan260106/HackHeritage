import React from 'react';
import { 
  BookOpen, 
  ExternalLink, 
  ShieldCheck, 
  Award
} from 'lucide-react';
import { EvidenceItem, LanguageCode } from '../types';
import { MULTILINGUAL_DICTIONARY } from '../data/coastalData';
import { localizeEvidence } from '../utils/presentationLocalization';

interface GroundedEvidenceDrawerProps {
  evidence: EvidenceItem[];
  groundedSummary: string;
  language: LanguageCode;
}

export const GroundedEvidenceDrawer: React.FC<GroundedEvidenceDrawerProps> = ({
  evidence,
  groundedSummary,
  language
}) => {
  const dict = MULTILINGUAL_DICTIONARY[language] || MULTILINGUAL_DICTIONARY.en;
  return (
    <div className="bg-white border border-slate-200/90 rounded-2xl p-5 shadow-sm space-y-4 text-slate-800">
      
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center space-x-2">
          <BookOpen className="h-4 w-4 text-sky-600" />
          <h3 className="text-sm font-bold text-slate-800 uppercase tracking-wider font-mono">
            {dict.evidenceGrounding}
          </h3>
        </div>
        <span className="text-[11px] font-mono text-slate-600 bg-slate-50 px-2.5 py-1 rounded-lg border border-slate-200">
          BGE-M3 Embeddings + BGE Reranker • Qdrant Vector Store
        </span>
      </div>

      {/* Synthesis Explanation Box */}
      <div className="bg-sky-50/80 border border-sky-200 rounded-xl p-4 space-y-2 shadow-2xs">
        <div className="flex items-center space-x-2 text-sky-800 text-xs font-bold font-mono">
          <ShieldCheck className="h-4 w-4 text-sky-600" />
          <span>{dict.groundedBriefing}</span>
        </div>
        <div className="text-xs text-slate-700 leading-relaxed whitespace-pre-line">
          {groundedSummary}
        </div>
      </div>

      {/* Retrieved Documents & Regulations Corpus */}
      <div className="space-y-3 pt-1">
        <div className="flex items-center justify-between text-xs font-bold text-slate-700">
          <span>{dict.citations}</span>
          <span className="text-[11px] font-mono text-slate-500">
            {evidence.length} {dict.sourceDocuments}
          </span>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
          {evidence.map((item) => {
            const display = localizeEvidence(item, language);
            return (
              <div
                key={item.id}
                className="bg-slate-50/80 border border-slate-200 rounded-xl p-3.5 space-y-2.5 hover:border-sky-300 hover:bg-white transition-all shadow-2xs flex flex-col justify-between"
              >
                <div className="space-y-1.5">
                  {/* Header: Authority & Reranker Score */}
                  <div className="flex items-center justify-between">
                    <span className="text-[10px] font-mono font-bold px-2 py-0.5 rounded bg-sky-100 text-sky-800 border border-sky-300">
                      {item.sourceAuthority}
                    </span>
                    <span className="text-[10px] font-mono text-emerald-800 bg-emerald-100 px-1.5 py-0.5 rounded border border-emerald-300 flex items-center gap-1 font-bold">
                      <Award className="h-3 w-3 text-emerald-600" />
                      <span>Match: {(item.relevanceScore * 100).toFixed(0)}%</span>
                    </span>
                  </div>

                  {/* Metadata Badges */}
                  <div className="flex flex-wrap items-center gap-1.5 pt-0.5">
                    {item.coast && item.coast !== 'all' && (
                      <span className="text-[9px] font-mono px-1.5 py-0.5 rounded bg-sky-50 text-sky-700 border border-sky-200 font-semibold">
                        {item.coast.toUpperCase()} COAST
                      </span>
                    )}
                    {item.jurisdiction && (
                      <span className="text-[9px] font-mono px-1.5 py-0.5 rounded bg-slate-100 text-slate-700 border border-slate-200">
                        {item.jurisdiction.replace(/_/g, ' ')}
                      </span>
                    )}
                    {item.topicCategory && (
                      <span className="text-[9px] font-mono px-1.5 py-0.5 rounded bg-slate-100 text-slate-700 border border-slate-200">
                        {item.topicCategory}
                      </span>
                    )}
                  </div>

                  {/* Title */}
                  <h4 className="text-xs font-bold text-slate-900 leading-tight">
                    {display.title}
                  </h4>

                  {/* Excerpt */}
                  <p className="text-[11px] text-slate-600 leading-relaxed bg-white p-2.5 rounded-lg border border-slate-200">
                    "{display.excerpt}"
                  </p>
                </div>

                {/* Compliance Rule & Link */}
                <div className="pt-2 border-t border-slate-200 flex items-center justify-between text-[10px] text-slate-500 font-mono">
                  <span className="truncate max-w-[200px]">Doc ID: {item.id}</span>
                  {item.officialUrl && (
                    <a
                      href={item.officialUrl}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="text-sky-700 hover:text-sky-900 flex items-center gap-1 hover:underline font-semibold"
                    >
                      <span>{dict.officialPortal}</span>
                      <ExternalLink className="h-3 w-3" />
                    </a>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      </div>

    </div>
  );
};
