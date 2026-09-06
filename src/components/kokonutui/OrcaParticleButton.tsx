import React, { useRef } from "react";
import { motion } from "motion/react";

export const OrcaParticleButton: React.FC<React.ButtonHTMLAttributes<HTMLButtonElement>> = ({ children, className = "", onClick, ...props }) => {
  const ref = useRef<HTMLButtonElement>(null);

  const burst = () => {
    const el = ref.current;
    if (el) {
      el.animate(
        [
          { transform: "scale(1)" },
          { transform: "scale(.97)" },
          { transform: "scale(1)" },
        ],
        { duration: 260, easing: "cubic-bezier(.22,1,.36,1)" },
      );
    }
    onClick?.(new MouseEvent("click") as unknown as React.MouseEvent<HTMLButtonElement>);
  };

  return (
    <motion.button
      ref={ref}
      whileHover={{ y: -2 }}
      whileTap={{ scale: 0.98 }}
      onClick={burst}
      className={`group relative inline-flex items-center justify-center overflow-hidden border border-[#7fd4c1]/45 bg-[#7fd4c1] px-6 py-3 font-mono text-[11px] font-bold uppercase tracking-[0.2em] text-[#061016] shadow-[0_14px_50px_rgba(127,212,193,.18)] transition-shadow hover:shadow-[0_18px_70px_rgba(127,212,193,.3)] ${className}`}
      {...props}
    >
      <span className="absolute inset-0 -translate-x-full bg-white/35 transition-transform duration-700 ease-out group-hover:translate-x-full" />
      <span className="relative">{children}</span>
    </motion.button>
  );
};
