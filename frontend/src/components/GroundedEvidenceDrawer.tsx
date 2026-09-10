import React from 'react';
import { 
  BookOpen, 
  ExternalLink, 
  ShieldCheck, 
  Scale, 
  FileText, 
  Award, 
  CheckCircle,
  Search
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
    <div className="bg-slate-900/90 border border-slate-800 rounded-2xl p-5 shadow-xl space-y-4">
      
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center space-x-2">
          <BookOpen className="h-4 w-4 text-cyan-400" />
          <h3 className="text-sm font-bold text-slate-100 uppercase tracking-wider font-mono">
            {dict.evidenceGrounding}
          </h3>
        </div>
        <span className="text-[11px] font-mono text-slate-400 bg-slate-950 px-2.5 py-1 rounded-lg border border-slate-800">
          BGE-M3 Embeddings + BGE Reranker • Qdrant Vector Store
        </span>
      </div>

      {/* Synthesis Explanation Box */}
      <div className="bg-slate-950/80 border border-cyan-500/30 rounded-xl p-4 space-y-2">
        <div className="flex items-center space-x-2 text-cyan-400 text-xs font-bold font-mono">
          <ShieldCheck className="h-4 w-4" />
          <span>{dict.groundedBriefing}</span>
        </div>
        <div className="text-xs text-slate-200 leading-relaxed whitespace-pre-line">
          {groundedSummary}
        </div>
      </div>

      {/* Retrieved Documents & Regulations Corpus */}
      <div className="space-y-3 pt-1">
        <div className="flex items-center justify-between text-xs font-bold text-slate-300">
          <span>{dict.citations}</span>
          <span className="text-[11px] font-mono text-slate-400">
            {evidence.length} {dict.sourceDocuments}
          </span>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
          {evidence.map((item) => (
            (() => { const display = localizeEvidence(item, language); return (
            <div
              key={item.id}
              className="bg-slate-950/70 border border-slate-800 rounded-xl p-3.5 space-y-2.5 hover:border-slate-700 transition-all flex flex-col justify-between"
            >
              <div className="space-y-1.5">
                {/* Header: Authority & Reranker Score */}
                <div className="flex items-center justify-between">
                  <span className="text-[10px] font-mono font-bold px-2 py-0.5 rounded bg-cyan-950 text-cyan-300 border border-cyan-800">
                    {item.sourceAuthority}
                  </span>
                  <span className="text-[10px] font-mono text-emerald-400 bg-emerald-950/60 px-1.5 py-0.5 rounded border border-emerald-900 flex items-center gap-1">
                    <Award className="h-3 w-3" />
                    <span>Match: {(item.relevanceScore * 100).toFixed(0)}%</span>
                  </span>
                </div>

                {/* Title */}
                <h4 className="text-xs font-bold text-slate-100 leading-tight">
                  {display.title}
                </h4>

                {/* Excerpt */}
                <p className="text-[11px] text-slate-300 leading-relaxed bg-slate-900/60 p-2 rounded-lg border border-slate-800/80">
                  "{display.excerpt}"
                </p>
              </div>

              {/* Compliance Rule & Link */}
              <div className="pt-2 border-t border-slate-800/80 flex items-center justify-between text-[10px] text-slate-400 font-mono">
                <span className="truncate max-w-[200px]">Doc ID: {item.id}</span>
                {item.officialUrl && (
                  <a
                    href={item.officialUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-cyan-400 hover:text-cyan-300 flex items-center gap-1 hover:underline"
                  >
                    <span>{dict.officialPortal}</span>
                    <ExternalLink className="h-3 w-3" />
                  </a>
                )}
              </div>
            </div>); })()
          ))}
        </div>
      </div>

    </div>
  );
};
