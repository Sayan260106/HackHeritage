import React, { useId } from 'react';

interface OrcaWaveLogoProps {
  size?: 'sm' | 'md' | 'lg' | 'custom';
  className?: string;
  variant?: 'console' | 'home' | 'sidebar';
}

/**
 * OrcaWaveLogo — High-precision marine wave logo with continuous
 * left-to-right traveling wave crests clipped & faded at both borders.
 * Waves appear on the left, propagate rightward, and dissolve on the right.
 */
export const OrcaWaveLogo: React.FC<OrcaWaveLogoProps> = ({
  size = 'md',
  className = '',
  variant = 'console',
}) => {
  const uniqueId = useId().replace(/:/g, '');
  const maskId = `orca-fade-mask-${uniqueId}`;
  const gradId = `orca-fade-grad-${uniqueId}`;

  // Dimensions based on size preset
  const sizeClasses = {
    sm: 'h-8 w-8',
    md: 'h-9 w-9',
    lg: 'h-10 w-10',
    custom: '',
  }[size];

  // Harmonious backdrop styling depending on variant
  const variantStyles = {
    home: 'border border-shoal/40 bg-abyssal/80 shadow-md shadow-shoal/20 hover:border-shoal/70',
    sidebar: 'border border-shoal/35 bg-abyssal/60 hover:border-shoal/60',
    console: 'border border-cyan-400/40 bg-gradient-to-br from-cyan-950/80 via-slate-950/90 to-blue-950/80 shadow-lg shadow-cyan-500/15 hover:border-cyan-400/70',
  }[variant];

  // Mathematical smooth sine wave path (wavelength L = 24px)
  // Repeating for 7 full periods so translation is 100% continuous and seamless
  const generateWaveD = (startY: number) => {
    let d = `M -48 ${startY} `;
    for (let i = 0; i < 7; i++) {
      // 12px crest (up), 12px trough (down)
      d += `c 3.31 -2.6 8.69 -2.6 12 0 c 3.31 2.6 8.69 2.6 12 0 `;
    }
    return d;
  };

  return (
    <div
      className={`orca-wave-logo-container group relative flex shrink-0 items-center justify-center rounded-lg overflow-hidden transition-all duration-300 ${sizeClasses} ${variantStyles} ${className}`}
      title="ORCA-X Marine Observation System"
    >
      {/* Bioluminescent ocean depth glow behind waves on hover */}
      <div className="absolute inset-0 bg-gradient-to-r from-teal-500/0 via-cyan-400/15 to-blue-500/0 opacity-0 group-hover:opacity-100 transition-opacity duration-500 pointer-events-none" />

      {/* SVG Canvas with Left-to-Right Traveling Waves */}
      <svg
        viewBox="0 0 36 36"
        className="h-full w-full pointer-events-none"
        xmlns="http://www.w3.org/2000/svg"
        fill="none"
      >
        <defs>
          {/* Gradient mask: Waves appear at left edge (0% to 22%) and fade away at right edge (78% to 100%) */}
          <linearGradient id={gradId} x1="0%" y1="0%" x2="100%" y2="0%">
            <stop offset="0%" stopColor="white" stopOpacity="0" />
            <stop offset="22%" stopColor="white" stopOpacity="1" />
            <stop offset="78%" stopColor="white" stopOpacity="1" />
            <stop offset="100%" stopColor="white" stopOpacity="0" />
          </linearGradient>

          <mask id={maskId}>
            <rect x="0" y="0" width="36" height="36" fill={`url(#${gradId})`} />
          </mask>
        </defs>

        {/* Group with edge fade mask applied */}
        <g mask={`url(#${maskId})`}>
          {/* Wave Tier 1: Top Crest (Deep sky cyan, swiftest current) */}
          <path
            d={generateWaveD(11)}
            stroke="#38bdf8"
            strokeWidth="1.9"
            strokeLinecap="round"
            className="orca-wave-stream-1"
            opacity="0.9"
          />

          {/* Wave Tier 2: Middle Swell (Bioluminescent emerald-teal, core current) */}
          <path
            d={generateWaveD(18)}
            stroke="#2dd4bf"
            strokeWidth="2.1"
            strokeLinecap="round"
            className="orca-wave-stream-2"
            opacity="0.95"
          />

          {/* Wave Tier 3: Lower Surge (Deep indigo-blue, gentle tide) */}
          <path
            d={generateWaveD(25)}
            stroke="#818cf8"
            strokeWidth="1.9"
            strokeLinecap="round"
            className="orca-wave-stream-3"
            opacity="0.85"
          />
        </g>
      </svg>
    </div>
  );
};
