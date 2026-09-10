import React from "react";
import { cn } from "../../lib/cn";

interface GlassPanelProps {
  children: React.ReactNode;
  className?: string;
  /** Adds the fine graticule printed under a chart's soundings. */
  ruled?: boolean;
}

/**
 * The standard ORCA-X surface: shelf navy lifted off the abyssal ground with a
 * contour-weight hairline and a single specular edge along the top, so panels
 * read as plates of glass laid over the chart rather than as flat boxes.
 */
export const GlassPanel: React.FC<GlassPanelProps> = ({
  children,
  className,
  ruled = false,
}) => (
  <div className={cn("relative overflow-hidden rounded-sm plate", className)}>
    <span
      aria-hidden="true"
      className="pointer-events-none absolute inset-x-0 top-0 h-px bg-gradient-to-r from-transparent via-shoal/35 to-transparent"
    />
    {ruled && (
      <span
        aria-hidden="true"
        className="graticule pointer-events-none absolute inset-0 opacity-60"
      />
    )}
    <div className="relative">{children}</div>
  </div>
);
