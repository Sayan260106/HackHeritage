import React, { useId, useLayoutEffect, useMemo, useRef } from "react";
import { animate, stagger, svg, withMotion } from "../../lib/anime";
import { cn } from "../../lib/cn";

/** Deterministic PRNG so the chart plate is identical on every render. */
function mulberry32(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const VIEW_W = 1200;
const VIEW_H = 820;

interface Isobath {
  d: string;
  depth: number;
  /** Sample points along the line, used to place soundings. */
  samples: { x: number; y: number }[];
}

/**
 * Builds nested isobaths — depth contours that run roughly parallel to a coast,
 * each a sum of a few harmonics so no two lines repeat. This is the shape of a
 * real continental-shelf survey: lines crowd together where the seabed falls
 * away steeply and spread out over flat ground.
 */
function buildIsobaths(count: number, seed: number): Isobath[] {
  const rand = mulberry32(seed);
  const lines: Isobath[] = [];

  for (let i = 0; i < count; i += 1) {
    /* `count - 1` would be a division by zero for a single contour, and NaN
       propagates into every path command from there. */
    const t = count > 1 ? i / (count - 1) : 0;
    // Contours crowd toward the bottom of the plate: the shelf break.
    const baseY = 70 + Math.pow(t, 1.45) * (VIEW_H - 130);
    const amp1 = 46 * (1 - t * 0.55) + rand() * 16;
    const amp2 = 19 * (1 - t * 0.4) + rand() * 9;
    const len1 = 380 + rand() * 240;
    const len2 = 130 + rand() * 90;
    const ph1 = rand() * Math.PI * 2;
    const ph2 = rand() * Math.PI * 2;

    const samples: { x: number; y: number }[] = [];
    for (let x = -40; x <= VIEW_W + 40; x += 24) {
      const y =
        baseY +
        amp1 * Math.sin(x / len1 + ph1) +
        amp2 * Math.sin(x / len2 + ph2);
      samples.push({ x, y: Math.round(y * 100) / 100 });
    }

    const d = samples
      .map((p, idx) => `${idx === 0 ? "M" : "L"}${p.x} ${p.y}`)
      .join(" ");

    // Soundings on an Indian shelf chart run from a few metres to abyssal.
    const depth = Math.round((6 + Math.pow(t, 2.1) * 2200) / 2) * 2;
    lines.push({ d, depth, samples });
  }

  return lines;
}

interface ContourFieldProps {
  className?: string;
  /** Number of isobaths to plot. */
  lines?: number;
  /** Print depth values along the contours, as a survey plate would. */
  soundings?: boolean;
  seed?: number;
  /** Draw the lines on with anime.js when the field mounts. */
  animateIn?: boolean;
}

/**
 * The plate every ORCA-X page sits on: a bathymetric contour field that draws
 * itself on, then drifts. Purely decorative, so it is hidden from assistive
 * technology and never intercepts pointer events.
 */
export const ContourField: React.FC<ContourFieldProps> = ({
  className,
  lines = 26,
  soundings = true,
  seed = 1974,
  animateIn = true,
}) => {
  const rootRef = useRef<SVGSVGElement>(null);
  /**
   * Gradient ids have to be unique per instance: the brief renders two contour
   * fields, and `url(#id)` binds to whichever matching node comes first in the
   * document. Sharing an id would leave the second field painting with the
   * first's gradient — and painting with nothing once the first unmounts.
   * React's generated id is stripped to alphanumerics so the fragment reference
   * stays valid whatever delimiters the running version wraps it in.
   */
  const uid = useId().replace(/[^a-zA-Z0-9]/g, "");
  const isobathId = `orca-isobath-${uid}`;
  const glowId = `orca-shoalglow-${uid}`;
  const isobaths = useMemo(() => buildIsobaths(lines, seed), [lines, seed]);

  // Place soundings at readable intervals, staggered across the plate so they
  // never stack into a column.
  const marks = useMemo(() => {
    if (!soundings) return [];
    const rand = mulberry32(seed + 7);
    return isobaths
      .filter((_, i) => i % 3 === 1)
      .map((line, i) => {
        const sample =
          line.samples[
            Math.floor(rand() * (line.samples.length - 14)) + 7
          ];
        return {
          key: `${line.depth}-${i}`,
          x: sample.x,
          y: sample.y,
          depth: line.depth,
        };
      });
  }, [isobaths, soundings, seed]);

  /* Layout effect so `createDrawable` clips the paths before the first paint;
     on a passive effect they would flash fully drawn for one frame. */
  useLayoutEffect(() => {
    const root = rootRef.current;
    if (!root || !animateIn) return;

    return withMotion(() => {
      const drawable = svg.createDrawable(
        root.querySelectorAll<SVGPathElement>("path[data-isobath]"),
      );
      return animate(drawable, {
        draw: "0 1",
        duration: 2200,
        delay: stagger(55),
        ease: "inOut(2)",
      });
    });
  }, [animateIn]);

  return (
    <div
      aria-hidden="true"
      className={cn("pointer-events-none overflow-hidden", className)}
    >
      <svg
        ref={rootRef}
        viewBox={`0 0 ${VIEW_W} ${VIEW_H}`}
        preserveAspectRatio="xMidYMid slice"
        className="h-full w-full animate-drift"
      >
        <defs>
          {/* Contours fade with depth, so the plate reads as a water column. */}
          <linearGradient id={isobathId} x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="#7fd4c1" stopOpacity="0.55" />
            <stop offset="55%" stopColor="#4fb9a2" stopOpacity="0.26" />
            <stop offset="100%" stopColor="#1f6e63" stopOpacity="0.1" />
          </linearGradient>
          <radialGradient id={glowId} cx="50%" cy="8%" r="72%">
            <stop offset="0%" stopColor="#7fd4c1" stopOpacity="0.14" />
            <stop offset="100%" stopColor="#060d14" stopOpacity="0" />
          </radialGradient>
        </defs>

        <rect width={VIEW_W} height={VIEW_H} fill={`url(#${glowId})`} />

        {isobaths.map((line, i) => (
          <path
            key={line.depth + "-" + i}
            data-isobath=""
            d={line.d}
            fill="none"
            stroke={`url(#${isobathId})`}
            /* Every fifth contour is an index line, drawn heavier — the
               convention that lets a navigator count depth at a glance. */
            strokeWidth={i % 5 === 0 ? 1.5 : 0.75}
            strokeLinecap="round"
          />
        ))}

        {marks.map((mark) => (
          <text
            key={mark.key}
            x={mark.x}
            y={mark.y - 5}
            fill="#7fd4c1"
            fillOpacity="0.34"
            fontSize="10.5"
            fontFamily="JetBrains Mono, monospace"
            fontStyle="italic"
            letterSpacing="0.5"
          >
            {mark.depth}
          </text>
        ))}
      </svg>
    </div>
  );
};
