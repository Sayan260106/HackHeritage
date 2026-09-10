import React from "react";
import { cn } from "../../lib/cn";

interface ShimmerTextProps {
  children: React.ReactNode;
  className?: string;
  /** Seconds per pass. */
  duration?: number;
}

/**
 * A slow specular pass across text, like light moving over wet chart varnish.
 * Used once per page at most — it is a highlight, not a texture.
 *
 * The `orca-shimmer` keyframes live in index.css rather than in a nested
 * `<style>` element: this renders inside an `<h1>`, where a style tag is
 * non-conforming markup, and every instance would re-declare the same rule.
 */
export const ShimmerText: React.FC<ShimmerTextProps> = ({
  children,
  className,
  duration = 5.5,
}) => (
  <span
    className={cn("bg-clip-text text-transparent", className)}
    style={{
      backgroundImage:
        "linear-gradient(100deg, #7fd4c1 12%, #e8ede9 34%, #f2b33d 50%, #e8ede9 66%, #7fd4c1 88%)",
      backgroundSize: "220% 100%",
      animation: `orca-shimmer ${duration}s linear infinite`,
    }}
  >
    {children}
  </span>
);
