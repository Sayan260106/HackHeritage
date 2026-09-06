import React from "react";
import { motion, useTransform, type MotionValue } from "motion/react";

interface OrcaCinematicWorldProps {
  progress: MotionValue<number>;
}

const Cloud = ({ x, y, scale = 1, opacity = 0.2 }: { x: string; y: string; scale?: number; opacity?: number }) => (
  <div
    className="absolute h-16 w-44 rounded-full bg-white/10 blur-2xl"
    style={{ left: x, top: y, transform: `scale(${scale})`, opacity }}
  />
);

export const OrcaCinematicWorld: React.FC<OrcaCinematicWorldProps> = ({ progress }) => {
  const oceanScale = useTransform(progress, [0, 0.22, 0.45], [1.15, 1.02, 0.88]);
  const horizonY = useTransform(progress, [0, 0.32, 0.52], ["42%", "32%", "18%"]);
  const shipX = useTransform(progress, [0, 0.22, 0.42], ["48%", "53%", "56%"]);
  const shipY = useTransform(progress, [0, 0.28, 0.5], ["58%", "62%", "82%"]);
  const shipOpacity = useTransform(progress, [0, 0.3, 0.48, 0.58], [1, 1, 0.55, 0]);
  const cloudOpacity = useTransform(progress, [0.25, 0.45, 0.62], [0, 0.75, 1]);
  const gridOpacity = useTransform(progress, [0.45, 0.62, 0.82], [0, 0.28, 0.65]);
  const dataGlow = useTransform(progress, [0.58, 0.76, 1], [0, 0.7, 0.95]);
  const sunScale = useTransform(progress, [0, 0.4, 0.65], [1, 1.35, 2.1]);

  return (
    <div aria-hidden="true" className="pointer-events-none fixed inset-0 z-0 overflow-hidden bg-[#02070b]">
      <motion.div
        className="absolute inset-[-12%]"
        style={{ scale: oceanScale }}
      >
        <div className="absolute inset-0 bg-[radial-gradient(circle_at_50%_35%,rgba(127,212,193,.18),transparent_38%),linear-gradient(180deg,#07131b_0%,#041018_46%,#02070b_100%)]" />
        <motion.div
          className="absolute inset-x-[-8%] h-[65%] bg-[radial-gradient(ellipse_at_center,rgba(36,122,132,.45),rgba(4,28,39,.85)_48%,#02070b_78%)]"
          style={{ top: horizonY }}
        />
        <div className="absolute inset-x-[-20%] bottom-[-12%] h-[52%] opacity-70 [background-image:repeating-radial-gradient(ellipse_at_center,rgba(127,212,193,.10)_0_1px,transparent_1px_20px)] [background-size:100%_28px] [transform:perspective(500px)_rotateX(62deg)]" />
      </motion.div>

      <motion.div className="absolute inset-0" style={{ opacity: cloudOpacity }}>
        <Cloud x="4%" y="18%" scale={1.4} opacity={0.22} />
        <Cloud x="29%" y="24%" scale={1.8} opacity={0.16} />
        <Cloud x="64%" y="17%" scale={1.55} opacity={0.2} />
        <Cloud x="78%" y="32%" scale={1.2} opacity={0.15} />
        <div className="absolute inset-0 bg-[linear-gradient(180deg,rgba(214,240,238,.07),transparent_55%,rgba(2,7,11,.9))]" />
      </motion.div>

      <motion.div
        className="absolute left-1/2 top-[42%] h-32 w-32 -translate-x-1/2 -translate-y-1/2 rounded-full bg-[#f2b33d]/20 blur-3xl"
        style={{ scale: sunScale, opacity: cloudOpacity }}
      />

      <motion.svg
        className="absolute inset-0 h-full w-full"
        viewBox="0 0 1200 800"
        preserveAspectRatio="none"
        style={{ opacity: gridOpacity }}
      >
        <defs>
          <pattern id="orca-grid" width="70" height="70" patternUnits="userSpaceOnUse">
            <path d="M70 0H0V70" fill="none" stroke="rgba(127,212,193,.16)" strokeWidth="1" />
          </pattern>
        </defs>
        <rect width="1200" height="800" fill="url(#orca-grid)" />
        <path d="M0 500 C220 410 350 560 540 455 S870 380 1200 470" fill="none" stroke="rgba(127,212,193,.35)" strokeWidth="2" strokeDasharray="8 14" />
        <path d="M0 610 C240 540 390 650 590 560 S930 500 1200 590" fill="none" stroke="rgba(242,179,61,.25)" strokeWidth="1" strokeDasharray="4 18" />
      </motion.svg>

      <motion.div
        className="absolute h-1.5 w-1.5 rounded-full bg-[#7fd4c1] shadow-[0_0_18px_5px_rgba(127,212,193,.45)]"
        style={{ left: "53%", top: "47%", opacity: dataGlow }}
      />
      <motion.div className="absolute left-[53%] top-[47%] h-32 w-32 -translate-x-1/2 -translate-y-1/2 rounded-full border border-[#7fd4c1]/20" style={{ scale: useTransform(progress, [0.58, 1], [0.3, 2.5]), opacity: dataGlow }} />

      <motion.div
        className="absolute"
        style={{ left: shipX, top: shipY, opacity: shipOpacity, translateX: "-50%", translateY: "-50%" }}
      >
        <svg width="230" height="110" viewBox="0 0 230 110" className="drop-shadow-[0_16px_22px_rgba(0,0,0,.45)]">
          <path d="M25 70 L52 83 H176 L205 69 L188 96 H48 Z" fill="#142d3b" stroke="#7fd4c1" strokeOpacity=".65" />
          <path d="M69 72 V35 H136 V72" fill="#0d202c" stroke="#7fd4c1" strokeOpacity=".45" />
          <path d="M82 35 V19 H116 V35" fill="#173848" stroke="#7fd4c1" strokeOpacity=".5" />
          <path d="M117 20 L144 10 V37 H117" fill="#0b1c26" stroke="#7fd4c1" strokeOpacity=".4" />
          <path d="M41 96 C72 103 120 102 162 96 S204 90 224 95" fill="none" stroke="#7fd4c1" strokeOpacity=".35" strokeWidth="2" />
          <circle cx="95" cy="51" r="3" fill="#f2b33d" />
        </svg>
      </motion.div>

      <div className="absolute inset-0 bg-[radial-gradient(circle_at_center,transparent_30%,rgba(2,7,11,.52)_100%)]" />
      <div className="absolute inset-0 bg-[linear-gradient(180deg,rgba(2,7,11,.1),rgba(2,7,11,.2)_45%,rgba(2,7,11,.92)_100%)]" />
    </div>
  );
};
