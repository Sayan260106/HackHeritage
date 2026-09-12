import React, { useId } from 'react';

interface OrcaWaveLogoProps {
  size?: 'sm' | 'md' | 'lg' | 'custom';
  className?: string;
  variant?: 'console' | 'home' | 'sidebar';
  theme?: 'dark' | 'light';
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
  theme,
}) => {
  const uniqueId = useId().replace(/:/g, '');
  const maskId = `orca-fade-mask-${uniqueId}`;
  const gradId = `orca-fade-grad-${uniqueId}`;

  // Automatically detect light mode if variant is sidebar or theme is light
  const isLight = theme === 'light' || (theme === undefined && variant === 'sidebar');

  // Dimensions based on size preset
  const sizeClasses = {
    sm: 'h-8 w-8',
    md: 'h-9 w-9',
    lg: 'h-10 w-10',
    custom: '',
  }[size];

  // Harmonious backdrop styling depending on variant & theme
  const variantStyles = isLight
    ? 'border border-sky-400/50 bg-gradient-to-br from-sky-500 via-sky-600 to-teal-600 shadow-sm shadow-sky-600/25 hover:border-sky-300 hover:shadow-md hover:shadow-sky-500/35'
    : {
        home: 'border border-cyan-400/40 bg-black/30 backdrop-blur-sm shadow-sm hover:border-cyan-400/80',
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
          {/* Wave Tier 1: Top Crest (Pure white in light mode, sky cyan in dark mode) */}
          <path
            d={generateWaveD(11)}
            stroke={isLight ? '#ffffff' : '#38bdf8'}
            strokeWidth={isLight ? '2.2' : '1.9'}
            strokeLinecap="round"
            className="orca-wave-stream-1"
            opacity={isLight ? '1' : '0.9'}
          />

          {/* Wave Tier 2: Middle Swell (Luminous cyan in light mode, emerald-teal in dark mode) */}
          <path
            d={generateWaveD(18)}
            stroke={isLight ? '#a5f3fc' : '#2dd4bf'}
            strokeWidth={isLight ? '2.4' : '2.1'}
            strokeLinecap="round"
            className="orca-wave-stream-2"
            opacity={isLight ? '1' : '0.95'}
          />

          {/* Wave Tier 3: Lower Surge (Bright mint-teal in light mode, indigo in dark mode) */}
          <path
            d={generateWaveD(25)}
            stroke={isLight ? '#99f6e4' : '#818cf8'}
            strokeWidth={isLight ? '2.2' : '1.9'}
            strokeLinecap="round"
            className="orca-wave-stream-3"
            opacity={isLight ? '0.95' : '0.85'}
          />
        </g>
      </svg>
    </div>
  );
};
