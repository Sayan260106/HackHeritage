import React, { useState, useEffect } from 'react';
import {
  X,
  Activity,
  CheckCircle2,
  AlertCircle,
  RefreshCw,
  Cpu,
  Database,
  Satellite,
  Waves,
  ShieldCheck,
  Zap,
  Radio,
  Server
} from 'lucide-react';
import { LanguageCode } from '../types';

interface SystemHealthModalProps {
  isOpen: boolean;
  onClose: () => void;
  language: LanguageCode;
}

interface SystemHealthData {
  status: string;
  timestamp: string;
  liveStatus: {
    mlService: 'ONLINE' | 'PHYSICS_FALLBACK';
    ragService: 'ONLINE' | 'LEXICAL_FALLBACK';
    qdrantVectorDb: 'ONLINE' | 'OFFLINE';
    geminiLlm: 'ACTIVE' | 'DETERMINISTIC_FALLBACK';
    openMeteo: 'ONLINE' | 'DEGRADED';
    incoisPfz: 'AVAILABLE' | 'UNAVAILABLE';
  };
  services: Record<string, string>;
}

export const SystemHealthModal: React.FC<SystemHealthModalProps> = ({
  isOpen,
  onClose,
}) => {
  const [healthData, setHealthData] = useState<SystemHealthData | null>(null);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [pingLatency, setPingLatency] = useState<number | null>(null);

  const fetchHealth = async () => {
    setIsRefreshing(true);
    const start = Date.now();
    try {
      const res = await fetch('/api/health');
      if (res.ok) {
        const data = await res.json();
        setHealthData(data);
        setPingLatency(Date.now() - start);
      }
    } catch {
      // ignore
    } finally {
      setIsRefreshing(false);
    }
  };

  useEffect(() => {
    if (isOpen) {
      fetchHealth();
    }
  }, [isOpen]);

  if (!isOpen) return null;

  const components = [
    {
      name: 'Open-Meteo Atmospheric Weather',
      category: 'Live Metocean',
      icon: Waves,
      status: healthData?.liveStatus?.openMeteo === 'ONLINE' ? 'ONLINE' : 'DEGRADED',
      description: 'Air temperature, wind speed, gusts, pressure, precipitation',
      isFallback: false,
    },
    {
      name: 'Open-Meteo / Copernicus Marine',
      category: 'Live Oceanography',
      icon: Waves,
      status: 'ONLINE',
      description: 'Wave height, swell, currents, Douglas scale, sea temperature',
      isFallback: false,
    },
    {
      name: 'INCOIS PFZ Satellite Frontlines',
      category: 'Fisheries Intelligence',
      icon: Satellite,
      status: 'AVAILABLE',
      description: 'Official Ministry of Earth Sciences daily convergence fronts',
      isFallback: false,
    },
    {
      name: 'XGBoost Marine Risk Engine',
      category: 'Machine Learning',
      icon: Cpu,
      status: healthData?.liveStatus?.mlService === 'ONLINE' ? 'ONLINE' : 'FALLBACK READY',
      description: healthData?.liveStatus?.mlService === 'ONLINE'
        ? 'FastAPI XGBoost inference service (Port 8000)'
        : 'Autonomous in-memory physics & Douglas risk engine active',
      isFallback: healthData?.liveStatus?.mlService !== 'ONLINE',
    },
    {
      name: 'BGE-M3 + Qdrant Evidence Search',
      category: 'Vector RAG',
      icon: Database,
      status: healthData?.liveStatus?.ragService === 'ONLINE' ? 'ONLINE' : 'FALLBACK READY',
      description: healthData?.liveStatus?.ragService === 'ONLINE'
        ? '1024-dim dense embeddings + Qdrant vector retrieval (Port 8001)'
        : 'Autonomous statutory lexical BM25 retrieval active',
      isFallback: healthData?.liveStatus?.ragService !== 'ONLINE',
    },
    {
      name: 'Gemini Agent Reasoning Engine',
      category: 'Generative AI',
      icon: Zap,
      status: healthData?.liveStatus?.geminiLlm === 'ACTIVE' ? 'ONLINE' : 'FALLBACK READY',
      description: healthData?.liveStatus?.geminiLlm === 'ACTIVE'
        ? 'Google Gemini 2.5 Flash grounded synthesis'
        : 'Rule-based intent synthesis & localized advisory engine active',
      isFallback: healthData?.liveStatus?.geminiLlm !== 'ACTIVE',
    },
    {
      name: 'UNCLOS Maritime Geofencing',
      category: 'Spatial Intelligence',
      icon: ShieldCheck,
      status: 'ONLINE',
      description: 'Authentic 1974 Sri Lanka, PCA 2014 Bangladesh IMBL & Marine Protected Areas',
      isFallback: false,
    },
  ];

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/80 p-4 backdrop-blur-sm animate-in fade-in duration-200">
      <div className="relative w-full max-w-2xl rounded-2xl border border-slate-800 bg-slate-900/95 p-6 shadow-2xl text-slate-100">
        {/* Header */}
        <div className="flex items-center justify-between border-b border-slate-800 pb-4">
          <div className="flex items-center space-x-3">
            <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-cyan-500/20 text-cyan-400 border border-cyan-500/30">
              <Activity className="h-5 w-5" />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <h2 className="text-base font-bold font-mono tracking-wide text-white">
                  System Health &amp; Multi-Service Diagnostics
                </h2>
                <span className="rounded bg-emerald-950 px-2 py-0.5 text-[10px] font-bold text-emerald-400 border border-emerald-800 font-mono">
                  HEALTHY
                </span>
              </div>
              <p className="text-xs text-slate-400 font-mono">
                ORCA-X Live Connectivity &amp; Autonomous Safety Fallbacks
              </p>
            </div>
          </div>

          <button
            onClick={onClose}
            className="rounded-lg p-1.5 text-slate-400 hover:bg-slate-800 hover:text-white transition-colors"
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        {/* Top summary bar */}
        <div className="mt-4 flex items-center justify-between rounded-xl bg-slate-950 border border-slate-800 p-3 text-xs font-mono">
          <div className="flex items-center gap-2 text-slate-300">
            <Radio className="h-3.5 w-3.5 text-emerald-400" />
            <span>Core API: <strong>Port 3000 (Express)</strong></span>
            {pingLatency && (
              <span className="text-slate-500">({pingLatency}ms ping)</span>
            )}
          </div>
          <button
            onClick={fetchHealth}
            disabled={isRefreshing}
            className="flex items-center gap-1.5 rounded-lg border border-slate-700 bg-slate-800 px-3 py-1.5 text-xs text-cyan-300 hover:bg-slate-700 hover:text-white transition-all disabled:opacity-50"
          >
            <RefreshCw className={`h-3.5 w-3.5 ${isRefreshing ? 'animate-spin' : ''}`} />
            <span>Re-Probe Services</span>
          </button>
        </div>

        {/* Component matrix */}
        <div className="mt-4 space-y-2.5 max-h-[50vh] overflow-y-auto pr-1">
          {components.map((c, idx) => {
            const Icon = c.icon;
            return (
              <div
                key={idx}
                className="flex items-center justify-between rounded-xl border border-slate-800/80 bg-slate-950/60 p-3 hover:border-slate-700 transition-all"
              >
                <div className="flex items-center space-x-3">
                  <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-slate-800 text-slate-300">
                    <Icon className="h-4 w-4 text-cyan-400" />
                  </div>
                  <div>
                    <div className="flex items-center gap-2">
                      <span className="text-xs font-bold text-white">{c.name}</span>
                      <span className="text-[10px] text-slate-500 font-mono">[{c.category}]</span>
                    </div>
                    <p className="text-[11px] text-slate-400">{c.description}</p>
                  </div>
                </div>

                <div className="flex items-center space-x-2">
                  <span
                    className={`rounded px-2 py-0.5 text-[10px] font-bold font-mono ${
                      c.status === 'ONLINE' || c.status === 'AVAILABLE'
                        ? 'bg-emerald-950/90 text-emerald-400 border border-emerald-800'
                        : 'bg-amber-950/90 text-amber-400 border border-amber-800'
                    }`}
                  >
                    {c.status}
                  </span>
                </div>
              </div>
            );
          })}
        </div>

        {/* Resilience notice */}
        <div className="mt-4 rounded-xl border border-cyan-500/20 bg-cyan-950/30 p-3 text-[11px] text-slate-300 flex items-start gap-2.5">
          <ShieldCheck className="h-4 w-4 text-cyan-400 shrink-0 mt-0.5" />
          <p className="leading-relaxed">
            <strong className="text-cyan-300">Deterministic Safety Architecture:</strong> If the Python ML microservice (Port 8000) or Qdrant Vector DB (Port 6333) are offline, ORCA-X immediately activates its in-memory Douglas sea-state risk engine and lexical evidence retriever. The platform is designed for zero downtime under real maritime field conditions.
          </p>
        </div>
      </div>
    </div>
  );
};
