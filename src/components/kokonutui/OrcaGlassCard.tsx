import React from "react";
import { motion } from "motion/react";

export const OrcaGlassCard: React.FC<React.PropsWithChildren<{ className?: string }>> = ({ children, className = "" }) => (
  <motion.div
    whileHover={{ y: -4 }}
    transition={{ type: "spring", stiffness: 260, damping: 22 }}
    className={`border border-white/10 bg-white/[0.045] shadow-[0_24px_80px_rgba(0,0,0,.22)] backdrop-blur-xl ${className}`}
  >
    {children}
  </motion.div>
);
