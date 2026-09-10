import React, { useCallback, useRef } from "react";
import { motion, useMotionValue, useSpring, useTransform } from "motion/react";
import { usePrefersReducedMotion } from "../../hooks/usePrefersReducedMotion";
import { cn } from "../../lib/cn";

interface AttractButtonProps {
  children: React.ReactNode;
  onClick?: () => void;
  className?: string;
  variant?: "buoy" | "outline";
  type?: "button" | "submit";
  "aria-label"?: string;
}

const PULL = 0.32;

/**
 * The primary action. The label is magnetically drawn toward the cursor before
 * the click lands — a small piece of physics that makes the button feel like it
 * wants to be pressed. Reduced motion disables the pull entirely.
 */
export const AttractButton: React.FC<AttractButtonProps> = ({
  children,
  onClick,
  className,
  variant = "buoy",
  type = "button",
  "aria-label": ariaLabel,
}) => {
  const ref = useRef<HTMLButtonElement>(null);
  const reduced = usePrefersReducedMotion();

  const px = useMotionValue(0);
  const py = useMotionValue(0);
  const sx = useSpring(px, { stiffness: 260, damping: 18, mass: 0.4 });
  const sy = useSpring(py, { stiffness: 260, damping: 18, mass: 0.4 });
  // The plate itself shifts less than its label, which reads as depth.
  const plateX = useTransform(sx, (v) => v * 0.4);
  const plateY = useTransform(sy, (v) => v * 0.4);

  const handleMove = useCallback(
    (event: React.PointerEvent<HTMLButtonElement>) => {
      if (reduced) return;
      const node = ref.current;
      if (!node) return;
      const rect = node.getBoundingClientRect();
      px.set((event.clientX - (rect.left + rect.width / 2)) * PULL);
      py.set((event.clientY - (rect.top + rect.height / 2)) * PULL);
    },
    [px, py, reduced],
  );

  const handleLeave = useCallback(() => {
    px.set(0);
    py.set(0);
  }, [px, py]);

  const skin =
    variant === "buoy"
      ? "bg-buoy text-abyssal border-buoy hover:bg-amber-300"
      : "border-shoal/35 text-shoal hover:border-shoal/70 hover:bg-shoal/8";

  return (
    <motion.button
      ref={ref}
      type={type}
      onClick={onClick}
      onPointerMove={handleMove}
      onPointerLeave={handleLeave}
      aria-label={ariaLabel}
      style={{ x: plateX, y: plateY }}
      /* Motion drives this in JS, so the stylesheet's reduced-motion rule
         cannot reach it — gate it here instead. */
      whileTap={reduced ? undefined : { scale: 0.975 }}
      className={cn(
        "sweep-sheen group relative inline-flex items-center justify-center gap-2.5 overflow-hidden",
        "rounded-sm border px-7 py-3.5 font-mono text-[11px] uppercase tracking-[0.22em]",
        "transition-colors duration-300",
        skin,
        className,
      )}
    >
      <motion.span
        style={{ x: sx, y: sy }}
        className="relative flex items-center gap-2.5"
      >
        {children}
      </motion.span>
    </motion.button>
  );
};
