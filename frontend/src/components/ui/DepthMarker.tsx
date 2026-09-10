import React from "react";
import { cn } from "../../lib/cn";

interface DepthMarkerProps {
  /** Metres below the surface. Sections descend as the page scrolls. */
  depth: number;
  label: string;
  className?: string;
}

/**
 * Section marker. ORCA-X labels its sections by depth rather than by number:
 * reading the page is a descent through the water column, and a sounding is the
 * unit this whole product is built on. The rule to the right is a contour.
 */
export const DepthMarker: React.FC<DepthMarkerProps> = ({
  depth,
  label,
  className,
}) => (
  <div className={cn("flex items-center gap-4", className)}>
    <span className="font-mono text-[11px] italic tabular-nums text-shoal/70">
      &minus;{depth.toLocaleString("en-IN")}&thinsp;m
    </span>
    <span className="plate-label text-fathom">{label}</span>
    <span
      aria-hidden="true"
      className="h-px flex-1 bg-gradient-to-r from-shoal/28 to-transparent"
    />
  </div>
);
