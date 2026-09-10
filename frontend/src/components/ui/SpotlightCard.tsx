import React, { useCallback, useRef } from "react";
import { cn } from "../../lib/cn";

interface SpotlightCardProps {
  children: React.ReactNode;
  className?: string;
  /** Spotlight tint. Defaults to shoal aqua. */
  glow?: string;
}

/**
 * Pointer-tracked spotlight surface. A soft light follows the cursor across the
 * plate, the way a chart-table lamp is moved across paper. The gradient is
 * driven by CSS custom properties, so pointer movement never triggers React
 * renders.
 */
export const SpotlightCard: React.FC<SpotlightCardProps> = ({
  children,
  className,
  glow = "127 212 193",
}) => {
  const ref = useRef<HTMLDivElement>(null);

  const handleMove = useCallback((event: React.PointerEvent<HTMLDivElement>) => {
    const node = ref.current;
    if (!node) return;
    const rect = node.getBoundingClientRect();
    node.style.setProperty("--spot-x", `${event.clientX - rect.left}px`);
    node.style.setProperty("--spot-y", `${event.clientY - rect.top}px`);
    node.style.setProperty("--spot-opacity", "1");
  }, []);

  const handleLeave = useCallback(() => {
    ref.current?.style.setProperty("--spot-opacity", "0");
  }, []);

  return (
    <div
      ref={ref}
      onPointerMove={handleMove}
      onPointerLeave={handleLeave}
      style={
        {
          "--spot-glow": glow,
          "--spot-opacity": "0",
        } as React.CSSProperties
      }
      className={cn(
        "group relative overflow-hidden rounded-sm plate transition-colors duration-500",
        "hover:border-shoal/30",
        className,
      )}
    >
      <div
        aria-hidden="true"
        className="pointer-events-none absolute inset-0 transition-opacity duration-300"
        style={{
          opacity: "var(--spot-opacity)",
          background:
            "radial-gradient(320px circle at var(--spot-x) var(--spot-y), rgb(var(--spot-glow) / 0.13), transparent 70%)",
        }}
      />
      <div className="relative">{children}</div>
    </div>
  );
};
