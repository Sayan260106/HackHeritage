import React, { useState } from 'react';
import { Compass, MapPin, Waves, ExternalLink, ArrowRight, Activity, ShieldCheck } from 'lucide-react';
import { COASTAL_LOCATIONS } from '../data/coastalData';

interface IndianCoastalMapProps {
  onSelectPort?: (portKey: string) => void;
}

// Visual map coordinates scaled to SVG viewBox 0 0 600 650
const MAP_PORTS = [
  { key: 'digha', name: 'Digha', state: 'West Bengal', x: 440, y: 150, risk: 'LOW', lat: '21.6°N', depth: '12m' },
  { key: 'paradeep', name: 'Paradeep', state: 'Odisha', x: 410, y: 210, risk: 'MODERATE', lat: '20.3°N', depth: '18m' },
  { key: 'puri', name: 'Puri', state: 'Odisha', x: 390, y: 245, risk: 'LOW', lat: '19.8°N', depth: '15m' },
  { key: 'visakhapatnam', name: 'Visakhapatnam', state: 'Andhra Pradesh', x: 360, y: 310, risk: 'LOW', lat: '17.7°N', depth: '22m' },
  { key: 'chennai', name: 'Chennai', state: 'Tamil Nadu', x: 310, y: 440, risk: 'MODERATE', lat: '13.1°N', depth: '25m' },
  { key: 'kochi', name: 'Kochi', state: 'Kerala', x: 200, y: 530, risk: 'LOW', lat: '9.9°N', depth: '20m' },
  { key: 'goa', name: 'Goa', state: 'Goa', x: 175, y: 380, risk: 'LOW', lat: '15.4°N', depth: '16m' },
  { key: 'mumbai', name: 'Mumbai', state: 'Maharashtra', x: 160, y: 275, risk: 'LOW', lat: '18.9°N', depth: '28m' },
];

export const IndianCoastalMap: React.FC<IndianCoastalMapProps> = ({ onSelectPort }) => {
  const [activePortKey, setActivePortKey] = useState<string>('digha');
  const activePort = MAP_PORTS.find((p) => p.key === activePortKey) || MAP_PORTS[0];

  const handlePortClick = (portKey: string) => {
    setActivePortKey(portKey);
    if (onSelectPort) {
      onSelectPort(portKey);
    }
  };

  return (
    <div className="orca-glass-panel rounded-2xl p-5 sm:p-7 shadow-2xl border border-cyan-500/30 overflow-hidden relative">
      
      {/* Header */}
      <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3 border-b border-slate-800 pb-4 mb-6">
        <div>
          <div className="flex items-center space-x-2">
            <span className="h-2 w-2 rounded-full bg-cyan-400 animate-pulse" />
            <h3 className="text-sm font-bold uppercase tracking-wider font-mono text-cyan-300">
              Interactive Indian Ocean & Coastal Hub Surveillance
            </h3>
          </div>
          <p className="text-xs text-slate-400 mt-1 font-sans">
            Click any coastal port beacon to inspect real-time marine observations & launch the live intelligence console.
          </p>
        </div>
        <span className="text-[10px] font-mono text-cyan-400 bg-cyan-500/10 border border-cyan-500/30 px-2.5 py-1 rounded-full shrink-0">
          Bay of Bengal & Arabian Sea
        </span>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-center">
        
        {/* SVG Interactive Map (Col Span 7) */}
        <div className="lg:col-span-7 relative flex justify-center items-center bg-slate-950/80 rounded-xl border border-slate-800/80 p-4 shadow-inner">
          <svg viewBox="0 0 600 650" className="w-full max-w-[480px] h-auto drop-shadow-xl">
            <defs>
              <linearGradient id="oceanGlow" x1="0%" y1="0%" x2="100%" y2="100%">
                <stop offset="0%" stopColor="#081420" stopOpacity="0.9" />
                <stop offset="100%" stopColor="#0a1c2c" stopOpacity="0.9" />
              </linearGradient>
              <filter id="glowEffect">
                <feGaussianBlur stdDeviation="3" result="coloredBlur" />
                <feMerge>
                  <feMergeNode in="coloredBlur" />
                  <feMergeNode in="SourceGraphic" />
                </feMerge>
              </filter>
            </defs>

            {/* Ocean Waters Backdrop */}
            <rect x="0" y="0" width="600" height="650" fill="url(#oceanGlow)" rx="12" />

            {/* Bathymetric Grid & Contour Lines */}
            <path d="M 0 100 Q 300 120 600 100 M 0 250 Q 300 280 600 250 M 0 400 Q 300 440 600 400 M 0 550 Q 300 580 600 550" 
                  stroke="#163f5c" strokeWidth="1" strokeDasharray="4,6" fill="none" opacity="0.4" />
            
            {/* Stylized Indian Coastal Peninsula Silhouette */}
            <path d="M 120 40 
                     C 180 80, 240 100, 320 120 
                     C 380 130, 420 140, 480 150 
                     C 450 200, 410 240, 370 290 
                     C 340 330, 320 380, 310 440 
                     C 300 480, 270 540, 240 580 
                     C 220 560, 210 520, 200 470 
                     C 190 420, 175 360, 160 280 
                     C 140 220, 110 120, 120 40 Z" 
                  fill="#0e2432" stroke="#7fd4c1" strokeWidth="1.5" strokeOpacity="0.4" filter="url(#glowEffect)" />

            {/* Arabian Sea Label */}
            <text x="70" y="420" fill="#4a7189" fontSize="11" fontFamily="monospace" letterSpacing="2">ARABIAN SEA</text>
            
            {/* Bay of Bengal Label */}
            <text x="420" y="380" fill="#4a7189" fontSize="11" fontFamily="monospace" letterSpacing="2">BAY OF BENGAL</text>
            
            {/* Indian Ocean Label */}
            <text x="210" y="620" fill="#4a7189" fontSize="11" fontFamily="monospace" letterSpacing="3">INDIAN OCEAN</text>

            {/* Maritime Boundary EEZ Dashed Line */}
            <path d="M 100 180 Q 240 320 220 600 M 500 170 Q 380 340 260 600" 
                  stroke="#2e9483" strokeWidth="1" strokeDasharray="2,4" opacity="0.5" fill="none" />

            {/* Port Beacon Nodes */}
            {MAP_PORTS.map((port) => {
              const isSelected = port.key === activePortKey;
              return (
                <g key={port.key} onClick={() => handlePortClick(port.key)} className="cursor-pointer group">
                  {/* Outer Pulsing Ring */}
                  {isSelected && (
                    <circle cx={port.x} cy={port.y} r="14" fill="none" stroke="#22d3ee" strokeWidth="1.5" className="animate-ping opacity-75" />
                  )}
                  {/* Outer Glow Circle */}
                  <circle cx={port.x} cy={port.y} r={isSelected ? '9' : '6'} 
                          fill={isSelected ? '#22d3ee' : port.risk === 'MODERATE' ? '#f59e0b' : '#10b981'} 
                          fillOpacity={isSelected ? '0.35' : '0.25'} 
                          stroke={isSelected ? '#22d3ee' : port.risk === 'MODERATE' ? '#f59e0b' : '#10b981'} 
                          strokeWidth="1.5" 
                          className="transition-all duration-300 group-hover:scale-125" />
                  {/* Center Dot */}
                  <circle cx={port.x} cy={port.y} r="3.5" 
                          fill={isSelected ? '#ffffff' : port.risk === 'MODERATE' ? '#f7ce7a' : '#6fd6ae'} />
                  {/* Port Label */}
                  <text x={port.x + 12} y={port.y + 4} 
                        fill={isSelected ? '#ffffff' : '#a8bfc8'} 
                        fontSize="10" 
                        fontWeight={isSelected ? 'bold' : 'normal'}
                        fontFamily="monospace"
                        className="transition-colors group-hover:fill-cyan-300">
                    {port.name}
                  </text>
                </g>
              );
            })}
          </svg>
        </div>

        {/* Selected Port Live Summary Card (Col Span 5) */}
        <div className="lg:col-span-5 space-y-4 bg-slate-900/90 border border-slate-800 rounded-xl p-5 shadow-xl">
          <div className="flex items-center justify-between border-b border-slate-800 pb-3">
            <div>
              <span className="text-[10px] font-mono uppercase tracking-wider text-cyan-400 font-bold">
                Selected Coastal Station
              </span>
              <h4 className="text-xl font-extrabold text-slate-100 flex items-center gap-2 mt-0.5">
                <MapPin className="h-5 w-5 text-cyan-400 shrink-0" />
                <span>{activePort.name}</span>
              </h4>
              <p className="text-xs text-slate-400 font-mono mt-0.5">{activePort.state} · Lat {activePort.lat}</p>
            </div>
            <span className={`text-[10px] font-mono font-bold px-2 py-1 rounded border ${
              activePort.risk === 'MODERATE' 
                ? 'bg-amber-500/20 text-amber-300 border-amber-500/40' 
                : 'bg-emerald-500/20 text-emerald-300 border-emerald-500/40'
            }`}>
              {activePort.risk} RISK
            </span>
          </div>

          <div className="grid grid-cols-2 gap-2.5 text-xs font-mono">
            <div className="bg-slate-950 p-2.5 rounded-lg border border-slate-800">
              <span className="text-[10px] text-slate-400 block">Sounding Depth</span>
              <strong className="text-cyan-300 text-sm">{activePort.depth}</strong>
            </div>
            <div className="bg-slate-950 p-2.5 rounded-lg border border-slate-800">
              <span className="text-[10px] text-slate-400 block">Live Data Status</span>
              <strong className="text-emerald-400 text-sm flex items-center gap-1">
                <span className="h-1.5 w-1.5 rounded-full bg-emerald-400 animate-pulse" />
                ONLINE
              </strong>
            </div>
          </div>

          <div className="space-y-2 pt-1">
            <div className="text-xs font-semibold text-slate-200 flex items-center gap-1.5">
              <ShieldCheck className="h-4 w-4 text-cyan-400 shrink-0" />
              <span>Authoritative Guidance</span>
            </div>
            <p className="text-xs text-slate-400 leading-relaxed">
              Open-Meteo marine forecast & Copernicus Sentinel catalogue profiles active for {activePort.name}. Operational launch score verified against INCOIS safety thresholds.
            </p>
          </div>

          {/* Launch Console Button */}
          <button
            onClick={() => onSelectPort && onSelectPort(activePort.key)}
            className="w-full mt-2 bg-gradient-to-r from-cyan-500 to-blue-600 hover:from-cyan-400 hover:to-blue-500 text-slate-950 font-bold py-3 px-4 rounded-xl text-xs uppercase tracking-wider flex items-center justify-center space-x-2 transition-all shadow-lg shadow-cyan-500/25 btn-micro-interactive"
          >
            <span>Launch Live Console ({activePort.name})</span>
            <ArrowRight className="h-4 w-4" />
          </button>
        </div>

      </div>
    </div>
  );
};
