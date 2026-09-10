import React, { useState, useCallback } from 'react';
import { hydrophoneEngine } from '../../services/hydrophoneAudio';

interface OrcaWordmarkProps {
  size?: 'sm' | 'md' | 'lg';
  className?: string;
  badge?: string;
  subtitle?: string;
}

/**
 * OrcaWordmark — Ultra-Realistic Copernicus Sentinel SAR Satellite AI Identity.
 *
 * Visual Features:
 * 1. Realistic Aerospace Sentinel Satellite (SVG):
 *    - Dual photovoltaic solar wings with multi-junction silicon cells and gold busbars.
 *    - Multi-Layer Insulation (MLI) aerospace chassis with high-gain communications dish.
 *    - Downward-facing Synthetic Aperture Radar (SAR) sensor with optical lens.
 *    - Active orbital navigation strobe beacon.
 * 2. Phased-Array Radar Swath Scan:
 *    - Conical radar swath beam projected directly from the SAR emitter.
 *    - High-frequency radar scan pulses rippling through the swath.
 * 3. 3.5s Progressive Reveal:
 *    - ORCA-X v2.4 starts completely hidden and is unveiled in lockstep under the radar pass.
 * 4. 100% In-Flow Telemetry Tag linking satellite SAR with hydrophone soundings.
 */
export const OrcaWordmark: React.FC<OrcaWordmarkProps> = ({
  size = 'md',
  className = '',
  badge = 'v2.4',
  subtitle,
}) => {
  const [sweepKey, setSweepKey] = useState(0);

  // Sizing tiers
  const sizeMap = {
    sm: { text: 'text-base', sub: 'text-[9px]', badge: 'text-[8.5px]', badgePad: 'px-1 py-0.2', topPad: 'pt-3.5' },
    md: { text: 'text-lg', sub: 'text-[9.5px]', badge: 'text-[9px]', badgePad: 'px-1.5 py-0.5', topPad: 'pt-4' },
    lg: { text: 'text-xl', sub: 'text-xs', badge: 'text-[10px]', badgePad: 'px-1.5 py-0.5', topPad: 'pt-4.5' },
  }[size];

  // Hover triggers an instant new orbital satellite pass
  const handleMouseEnter = useCallback(() => {
    setSweepKey((prev) => prev + 1);
    try {
      hydrophoneEngine.triggerSonarPing(1320);
    } catch {
      // Ignore if audio context not permitted yet
    }
  }, []);

  return (
    <div
      className={`orca-wordmark-wrapper group relative inline-flex flex-col select-none cursor-pointer ${className}`}
      onMouseEnter={handleMouseEnter}
    >
      {/* ── Main Wordmark Reveal Aperture ── */}
      <div className={`relative inline-flex items-center overflow-visible ${sizeMap.topPad}`}>
        
        {/* Dynamic Keyed Container: Disappears & progressively unveils under the satellite pass */}
        <div key={`reveal-${sweepKey}`} className="orca-reveal-track relative inline-flex items-center">
          
          {/* Content that starts disappeared and gets progressively unclipped from left to right over 3.5s */}
          <div className="orca-reveal-content flex items-baseline gap-2">
            
            {/* ORCA-X Tactical Typography */}
            <span className={`orca-tactical-text font-display font-black tracking-wider uppercase flex items-center text-white ${sizeMap.text}`}>
              
              {/* O — with tactical center sonar pip */}
              <span className="relative inline-block font-extrabold text-white group-hover:text-cyan-200 transition-colors">
                O
                <span className="orca-sonar-center-pip" />
              </span>

              {/* R */}
              <span className="inline-block font-bold text-slate-100 group-hover:text-cyan-100 transition-colors">
                R
              </span>

              {/* C */}
              <span className="inline-block font-bold text-slate-100 group-hover:text-teal-100 transition-colors">
                C
              </span>

              {/* A */}
              <span className="inline-block font-bold text-slate-100 group-hover:text-teal-200 transition-colors">
                A
              </span>

              {/* Telemetry Node Hyphen */}
              <span className="inline-flex items-center px-0.5">
                <span className="inline-block w-2.5 h-[2.5px] rounded-full bg-cyan-400 shadow-[0_0_8px_#38bdf8]" />
              </span>

              {/* X — with rotating tactical radar reticle */}
              <span className="relative inline-block font-extrabold text-cyan-300 group-hover:text-cyan-100 transition-colors">
                X
                {/* Rotating radar scope reticle */}
                <span className="orca-x-radar-reticle" />
                {/* Tactical target brackets */}
                <span className="orca-x-target-corner orca-x-tl" />
                <span className="orca-x-target-corner orca-x-br" />
              </span>
            </span>

            {/* Version Badge (revealed simultaneously with ORCA-X under the satellite swath) */}
            {badge && (
              <span className={`font-mono uppercase tracking-[0.16em] rounded bg-cyan-950/85 border border-cyan-500/50 text-cyan-300 shadow-sm shadow-cyan-950/70 group-hover:border-cyan-400 group-hover:text-cyan-100 transition-all ${sizeMap.badge} ${sizeMap.badgePad}`}>
                {badge}
              </span>
            )}
          </div>

          {/* ── Realistic Sentinel Satellite Scanner Unit ── */}
          <div className="orca-satellite-scanner pointer-events-none">
            
            {/* Realistic Aerospace Sentinel Satellite Vector Asset */}
            <svg
              viewBox="0 0 52 16"
              className="orca-satellite-svg w-[52px] h-[16px] overflow-visible drop-shadow-[0_0_8px_rgba(56,189,248,0.85)]"
              xmlns="http://www.w3.org/2000/svg"
            >
              <defs>
                {/* Silicon solar panel gradient */}
                <linearGradient id="sat-solar-grad" x1="0%" y1="0%" x2="100%" y2="100%">
                  <stop offset="0%" stopColor="#0284c7" />
                  <stop offset="50%" stopColor="#0369a1" />
                  <stop offset="100%" stopColor="#0c4a6e" />
                </linearGradient>

                {/* Gold MLI chassis gradient */}
                <linearGradient id="sat-chassis-grad" x1="0%" y1="0%" x2="100%" y2="100%">
                  <stop offset="0%" stopColor="#1e293b" />
                  <stop offset="60%" stopColor="#0f172a" />
                  <stop offset="100%" stopColor="#020617" />
                </linearGradient>
              </defs>

              {/* ── Left Solar Array Wing ── */}
              <g id="solar-left">
                {/* Panel Frame */}
                <rect x="0.5" y="4.5" width="18" height="7" rx="1" fill="url(#sat-solar-grad)" stroke="#38bdf8" strokeWidth="0.6" />
                {/* Photovoltaic Cell Dividers */}
                <line x1="6.5" y1="4.5" x2="6.5" y2="11.5" stroke="#7dd3fc" strokeWidth="0.4" strokeOpacity="0.7" />
                <line x1="12.5" y1="4.5" x2="12.5" y2="11.5" stroke="#7dd3fc" strokeWidth="0.4" strokeOpacity="0.7" />
                {/* Horizontal Gold Busbar */}
                <line x1="0.5" y1="8" x2="18.5" y2="8" stroke="#fbbf24" strokeWidth="0.4" strokeOpacity="0.8" />
                {/* Wing Connector Truss */}
                <rect x="18.5" y="7" width="2.5" height="2" fill="#94a3b8" />
              </g>

              {/* ── Satellite Central Payload Bus (Chassis) ── */}
              <g id="sat-body">
                {/* Main Body with MLI Insulation Trim */}
                <rect x="21" y="2.5" width="10" height="11" rx="1.5" fill="url(#sat-chassis-grad)" stroke="#38bdf8" strokeWidth="0.7" />
                <rect x="21.5" y="3" width="9" height="1.5" fill="#f59e0b" fillOpacity="0.8" />
                
                {/* High-Gain Parabolic Communications Dish (Top) */}
                <path d="M 23.5 2.5 C 23.5 0.5 28.5 0.5 28.5 2.5" fill="none" stroke="#e2e8f0" strokeWidth="0.8" />
                <line x1="26" y1="1" x2="26" y2="2.5" stroke="#38bdf8" strokeWidth="0.6" />

                {/* Downward Optical / SAR Sensor Lens (Bottom) */}
                <circle cx="26" cy="11.5" r="2" fill="#38bdf8" stroke="#ffffff" strokeWidth="0.6" />
                <circle cx="26" cy="11.5" r="0.8" fill="#ffffff" />

                {/* Pulsing Orbital Navigation Telemetry Strobe */}
                <circle cx="29.5" cy="3.5" r="1" fill="#4ade80" className="orca-sat-strobe-dot" />
              </g>

              {/* ── Right Solar Array Wing ── */}
              <g id="solar-right">
                {/* Wing Connector Truss */}
                <rect x="31" y="7" width="2.5" height="2" fill="#94a3b8" />
                {/* Panel Frame */}
                <rect x="33.5" y="4.5" width="18" height="7" rx="1" fill="url(#sat-solar-grad)" stroke="#38bdf8" strokeWidth="0.6" />
                {/* Photovoltaic Cell Dividers */}
                <line x1="39.5" y1="4.5" x2="39.5" y2="11.5" stroke="#7dd3fc" strokeWidth="0.4" strokeOpacity="0.7" />
                <line x1="45.5" y1="4.5" x2="45.5" y2="11.5" stroke="#7dd3fc" strokeWidth="0.4" strokeOpacity="0.7" />
                {/* Horizontal Gold Busbar */}
                <line x1="33.5" y1="8" x2="51.5" y2="8" stroke="#fbbf24" strokeWidth="0.4" strokeOpacity="0.8" />
              </g>
            </svg>

            {/* Downward Projected Phased-Array Electric-Blue SAR Swath Beam */}
            <div className="orca-satellite-swath-beam">
              {/* Internal Phased-Array Scan Wavefronts */}
              <div className="orca-sar-scan-line orca-sar-line-1" />
              <div className="orca-sar-scan-line orca-sar-line-2" />
            </div>
          </div>
        </div>

        {/* Ambient bioluminescent water glow aura behind letters */}
        <div className="absolute -inset-x-2 -inset-y-1 bg-cyan-500/10 blur-md rounded opacity-0 group-hover:opacity-100 transition-opacity duration-500 pointer-events-none" />
      </div>

      {/* ── Under-Text Hydrophone Ocean Acoustic Frequency Ribbon ── */}
      <div className="relative w-full h-[3px] overflow-hidden rounded-full bg-slate-950/90 border border-cyan-950/80 mt-1 shadow-inner">
        {/* Deep ocean acoustic wave track */}
        <div className="orca-hydrophone-wave-track" />
        {/* Traveling Sonar Pulse Ping Node */}
        <div className="orca-sonar-ping-node" />
      </div>

      {/* ── In-Flow Tactical Telemetry Readout (Connecting Satellite SAR with Hydrophone Array) ── */}
      <div className="flex items-center justify-between gap-1.5 mt-0.5 font-mono text-[8px] uppercase tracking-[0.12em] text-cyan-400/90 pointer-events-none w-full">
        <span className="flex items-center gap-1 shrink-0">
          <span className="relative flex h-1.5 w-1.5 shrink-0">
            <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-emerald-400/80" />
            <span className="relative inline-flex h-1.5 w-1.5 rounded-full bg-emerald-300" />
          </span>
          <span className="font-semibold text-cyan-300">SENTINEL SAR</span>
        </span>
        <span className="text-slate-600 font-bold">·</span>
        <span className="shrink-0 text-slate-300">42.4 kHz</span>
        <span className="text-slate-600 font-bold">·</span>
        <span className="shrink-0 text-cyan-200 font-bold tracking-wider">18°54&apos;N</span>
      </div>

      {/* Subtitle / Telemetry Legend */}
      {subtitle && (
        <p className={`mt-0.5 truncate font-mono tracking-[0.14em] text-fathom group-hover:text-slate-300 transition-colors ${sizeMap.sub}`}>
          {subtitle}
        </p>
      )}
    </div>
  );
};
