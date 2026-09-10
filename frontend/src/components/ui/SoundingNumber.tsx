import React, { useEffect, useRef, useState } from "react";
import { useInView } from "motion/react";
import { animate, motionOK } from "../../lib/anime";
import { cn } from "../../lib/cn";

interface SoundingNumberProps {
  value: number;
  /** Decimal places to hold while counting and at rest. */
  precision?: number;
  suffix?: string;
  prefix?: string;
  className?: string;
  duration?: number;
}

/**
 * A figure that runs up to its value the way a depth sounder settles on a
 * reading. anime.js drives the count on a plain object; React only re-renders
 * the formatted string.
 */
export const SoundingNumber: React.FC<SoundingNumberProps> = ({
  value,
  precision = 0,
  suffix,
  prefix,
  className,
  duration = 1500,
}) => {
  const ref = useRef<HTMLSpanElement>(null);
  const inView = useInView(ref, { once: true, margin: "-8% 0px" });
  const [shown, setShown] = useState(() => (motionOK() ? 0 : value));

  useEffect(() => {
    if (!inView) return;
    if (!motionOK()) {
      setShown(value);
      return;
    }

    const counter = { v: 0 };
    const instance = animate(counter, {
      v: value,
      duration,
      ease: "out(3)",
      onUpdate: () => setShown(counter.v),
    });

    return () => {
      instance.revert?.();
      setShown(value);
    };
  }, [inView, value, duration]);

  return (
    <span ref={ref} className={cn("tabular-nums", className)}>
      {prefix}
      {shown.toLocaleString("en-IN", {
        minimumFractionDigits: precision,
        maximumFractionDigits: precision,
      })}
      {suffix}
    </span>
  );
};
