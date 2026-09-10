import React from "react";
import { cn } from "../../lib/cn";

/**
 * One pass of the station list. Declared at module scope rather than inside
 * `Marquee`: a nested component is a fresh type on every parent render, which
 * would remount the whole rail and restart its animation mid-scroll.
 */
const Row: React.FC<{ items: string[]; hidden?: boolean }> = ({
  items,
  hidden = false,
}) => (
  <ul
    aria-hidden={hidden || undefined}
    className="flex shrink-0 items-center gap-8 pr-8"
  >
    {items.map((item, i) => (
      <li
        key={`${item}-${i}`}
        className="flex shrink-0 items-center gap-3 font-mono text-[11px] tracking-wider text-fathom"
      >
        <span aria-hidden="true" className="text-shoal/50">
          &#9671;
        </span>
        <span className="hydrographic whitespace-nowrap">{item}</span>
      </li>
    ))}
  </ul>
);

/**
 * A continuously scrolling rail. Used once, to carry the live station list
 * across the brief — the coast is long, and the rail says so without a map.
 * The second pass is a seam-filler and is hidden from assistive technology.
 *
 * The `orca-marquee` keyframes live in index.css. The global reduced-motion
 * rule there collapses this animation for anyone who asked the interface to
 * hold still — a stylesheet `!important` outranks the inline duration below.
 */
export const Marquee: React.FC<{
  items: string[];
  className?: string;
  duration?: number;
  reverse?: boolean;
}> = ({ items, className, duration = 42, reverse = false }) => (
  <div
    className={cn(
      "relative flex overflow-hidden",
      // Feather both ends so the rail dissolves rather than being cut off.
      "[mask-image:linear-gradient(to_right,transparent,black_9%,black_91%,transparent)]",
      className,
    )}
  >
    <div
      className="flex min-w-full shrink-0 items-center"
      style={{
        animation: `orca-marquee ${duration}s linear infinite${
          reverse ? " reverse" : ""
        }`,
      }}
    >
      <Row items={items} />
      <Row items={items} hidden />
    </div>
  </div>
);
