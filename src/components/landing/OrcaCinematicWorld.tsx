import React from "react";
import { motion, useTransform, type MotionValue } from "motion/react";

interface OrcaCinematicWorldProps { progress: MotionValue<number>; }

const Cloud = ({ x, y, width = 280, opacity = 1 }: { x: string; y: string; width?: number; opacity?: number }) => (
  <div
    className="absolute h-24 rounded-[999px] bg-white/[0.09] blur-3xl"
    style={{ left: x, top: y, width, opacity }}
  />
);

const Vessel = () => (
  <svg width="470" height="210" viewBox="0 0 470 210" className="overflow-visible drop-shadow-[0_28px_45px_rgba(0,0,0,.72)]">
    <defs>
      <linearGradient id="orca-hull-v2" x1="0" x2="1">
        <stop offset="0" stopColor="#07151d" />
        <stop offset=".42" stopColor="#235765" />
        <stop offset=".72" stopColor="#12343f" />
        <stop offset="1" stopColor="#050d13" />
      </linearGradient>
      <linearGradient id="orca-cabin-v2" x1="0" y1="0" x2="0" y2="1">
        <stop offset="0" stopColor="#1c4654" />
        <stop offset="1" stopColor="#071922" />
      </linearGradient>
    </defs>
    <path d="M42 112 L95 139 H355 L427 101 L376 159 H82 Z" fill="url(#orca-hull-v2)" stroke="#b9eee4" strokeOpacity=".92" strokeWidth="2" />
    <path d="M101 113 V58 H258 V113" fill="url(#orca-cabin-v2)" stroke="#a6e6da" strokeOpacity=".72" strokeWidth="1.5" />
    <path d="M126 58 V34 H215 V58" fill="#1a3f4d" stroke="#b7eee5" strokeOpacity=".65" />
    <path d="M216 36 L278 15 V61 H216" fill="#091820" stroke="#b7eee5" strokeOpacity=".58" />
    <path d="M278 16 V92" stroke="#b7eee5" strokeOpacity=".55" strokeWidth="2" />
    <path d="M286 22 L332 40 L286 57 Z" fill="#1b4856" stroke="#b7eee5" strokeOpacity=".5" />
    {[143,168,193,218].map((cx) => <rect key={cx} x={cx} y="72" width="12" height="9" rx="1.5" fill="#a7eee0" fillOpacity=".78" />)}
    <rect x="244" y="75" width="18" height="11" rx="2" fill="#f2b33d" fillOpacity=".82" />
    <circle cx="162" cy="56" r="5" fill="#f6c35b" className="animate-pulse" />
    <path d="M0 170 C66 144 111 184 179 169 S312 147 470 174" fill="none" stroke="#7fd4c1" strokeOpacity=".56" strokeWidth="6" />
    <path d="M27 179 C96 162 138 192 208 178 S347 163 430 183" fill="none" stroke="#d8f6ef" strokeOpacity=".3" strokeWidth="3" />
  </svg>
);

const Person = () => (
  <svg width="250" height="360" viewBox="0 0 250 360" className="overflow-visible drop-shadow-[0_25px_40px_rgba(0,0,0,.58)]">
    <circle cx="126" cy="61" r="31" fill="#b88968" />
    <path d="M95 61 C94 35 110 23 128 23 C151 24 164 40 158 62 C145 47 123 48 95 61Z" fill="#101419" />
    <path d="M77 178 C80 128 96 103 126 103 C156 103 174 130 177 178 L161 285 H91 Z" fill="#12323d" stroke="#a1e8dc" strokeOpacity=".38" strokeWidth="1.5" />
    <path d="M92 285 L70 349 M158 285 L184 349" stroke="#08131a" strokeWidth="28" strokeLinecap="round" />
    <path d="M92 150 L57 213 M162 151 L191 204" stroke="#1b4652" strokeWidth="22" strokeLinecap="round" />
    <rect x="171" y="192" width="39" height="70" rx="7" fill="#071117" stroke="#91e2d4" strokeOpacity=".86" />
    <rect x="177" y="199" width="27" height="48" rx="3" fill="#0b3038" />
    <circle cx="190.5" cy="254" r="2.5" fill="#f2b33d" />
  </svg>
);

const Satellite = () => (
  <svg width="190" height="120" viewBox="0 0 190 120" className="drop-shadow-[0_0_30px_rgba(127,212,193,.34)]">
    <rect x="81" y="40" width="38" height="30" rx="4" fill="#112e39" stroke="#c1eee6" strokeOpacity=".82" />
    <rect x="18" y="32" width="53" height="43" rx="2" fill="#1a4655" stroke="#91e4d6" strokeOpacity=".68" />
    <rect x="119" y="32" width="53" height="43" rx="2" fill="#1a4655" stroke="#91e4d6" strokeOpacity=".68" />
    <path d="M100 40 V12 M100 70 V108 M81 55 H54 M119 55 H146" stroke="#d0f6ef" strokeOpacity=".68" strokeWidth="2" />
    <circle cx="100" cy="55" r="7" fill="#f2b33d" />
  </svg>
);

export const OrcaCinematicWorld: React.FC<OrcaCinematicWorldProps> = ({ progress }) => {
  const oceanScale = useTransform(progress, [0, .16, .34, .48], [1.08, 1.03, .92, .72]);
  const horizonY = useTransform(progress, [0, .22, .4, .55], ["53%", "45%", "31%", "16%"]);
  const oceanLight = useTransform(progress, [0, .18, .4, .55], [1, 1, .75, .2]);
  const vesselX = useTransform(progress, [0, .16, .31, .45], ["52%", "54%", "56%", "57%"]);
  const vesselY = useTransform(progress, [0, .18, .34, .46], ["67%", "64%", "48%", "25%"]);
  const vesselScale = useTransform(progress, [0, .18, .34, .47], [.98, 1.05, .7, .18]);
  const vesselOpacity = useTransform(progress, [0, .34, .46, .56], [1, 1, .55, 0]);
  const wakeOpacity = useTransform(progress, [0, .24, .42], [1, .75, 0]);
  const cloudOpacity = useTransform(progress, [.22, .36, .54, .7], [0, .45, 1, .55]);
  const cloudDrift = useTransform(progress, [0, 1], [0, -5]);
  const starsOpacity = useTransform(progress, [.48, .62, 1], [0, .7, 1]);
  const atmosphereOpacity = useTransform(progress, [.38, .55, .72], [0, .5, 1]);
  const personOpacity = useTransform(progress, [.55, .63, .84], [0, 1, 1]);
  const personX = useTransform(progress, [.55, .63, .84], ["-16%", "18%", "18%"]);
  const personY = useTransform(progress, [.55, .63, .84], ["68%", "57%", "53%"]);
  const personScale = useTransform(progress, [.55, .63, .84], [.42, .92, 1]);
  const satelliteOpacity = useTransform(progress, [.6, .69, .9], [0, 1, 1]);
  const satelliteX = useTransform(progress, [.6, .69, .9], ["105%", "74%", "77%"]);
  const satelliteY = useTransform(progress, [.6, .69, .9], ["14%", "20%", "19%"]);
  const routeOpacity = useTransform(progress, [.56, .67, .96], [0, 1, 1]);
  const routePathOpacity = useTransform(progress, [.55, .72], [0, 1]);
  const packetScale = useTransform(progress, [.56, .66, .78, .92], [.25, 1, .72, 1.15]);
  const routeScale = useTransform(progress, [.56, 1], [.5, 2.9]);
  const sunOpacity = useTransform(progress, [0, .28, .52], [.82, .7, 0]);

  return (
    <div aria-hidden="true" className="pointer-events-none fixed inset-0 z-0 overflow-hidden bg-[#02070b]">
      <motion.div className="absolute inset-[-12%]" style={{ scale: oceanScale }}>
        <div className="absolute inset-0 bg-[radial-gradient(ellipse_at_50%_36%,rgba(75,174,178,.28),transparent_43%),linear-gradient(180deg,#06141d_0%,#05202a_46%,#02070b_100%)]" />
        <motion.div className="absolute inset-x-[-10%] h-[70%] bg-[radial-gradient(ellipse_at_center,rgba(29,133,143,.72),rgba(4,48,59,.96)_47%,#02070b_78%)]" style={{ top: horizonY, opacity: oceanLight }} />
        <div className="absolute inset-x-[-15%] bottom-[-10%] h-[58%] opacity-90 [background-image:repeating-radial-gradient(ellipse_at_center,rgba(139,226,212,.14)_0_1px,transparent_1px_24px)] [background-size:100%_38px] [transform:perspective(650px)_rotateX(64deg)]" />
        <motion.div className="absolute inset-0 bg-[linear-gradient(180deg,transparent,rgba(127,212,193,.05)_46%,rgba(2,7,11,.82))]" style={{ opacity: oceanLight }} />
      </motion.div>

      <motion.div className="absolute left-[72%] top-[22%] h-32 w-32 rounded-full bg-[#f6c56b]/25 blur-3xl" style={{ opacity: sunOpacity }} />
      <motion.div className="absolute inset-0" style={{ opacity: cloudOpacity, x: cloudDrift }}>
        <Cloud x="-9%" y="13%" width={430} opacity={.8} />
        <Cloud x="13%" y="24%" width={520} opacity={.72} />
        <Cloud x="56%" y="11%" width={470} opacity={.76} />
        <Cloud x="78%" y="28%" width={380} opacity={.7} />
        <div className="absolute inset-0 bg-[linear-gradient(180deg,rgba(218,244,240,.08),transparent_55%,rgba(2,7,11,.9))]" />
      </motion.div>

      <motion.div className="absolute inset-0" style={{ opacity: starsOpacity }}>
        {[["8%","16%"],["20%","9%"],["31%","19%"],["44%","12%"],["61%","7%"],["74%","17%"],["91%","11%"],["86%","34%"]].map(([left, top], i) => (
          <span key={i} className="absolute h-1 w-1 rounded-full bg-white/65 shadow-[0_0_8px_rgba(215,245,238,.45)]" style={{ left, top }} />
        ))}
      </motion.div>

      <motion.div className="absolute" style={{ left: vesselX, top: vesselY, scale: vesselScale, opacity: vesselOpacity, x: "-50%", y: "-50%" }}>
        <Vessel />
      </motion.div>
      <motion.div className="absolute left-[51%] top-[71%] h-20 w-[38%] rounded-[50%] bg-[#7fd4c1]/10 blur-2xl" style={{ opacity: wakeOpacity }} />

      <motion.svg className="absolute inset-0 h-full w-full" viewBox="0 0 1200 800" preserveAspectRatio="none" style={{ opacity: routePathOpacity }}>
        <defs>
          <linearGradient id="orca-route-v2" x1="0" x2="1">
            <stop offset="0" stopColor="#7fd4c1" stopOpacity="0" />
            <stop offset=".42" stopColor="#7fd4c1" stopOpacity=".8" />
            <stop offset="1" stopColor="#f2b33d" stopOpacity=".86" />
          </linearGradient>
        </defs>
        <path d="M170 610 C330 500 405 420 520 345 C635 270 720 220 850 170" fill="none" stroke="rgba(255,255,255,.08)" strokeWidth="2" />
        <path d="M170 610 C330 500 405 420 520 345 C635 270 720 220 850 170" fill="none" stroke="url(#orca-route-v2)" strokeWidth="2" strokeDasharray="5 13" />
        <circle cx="170" cy="610" r="7" fill="#7fd4c1" />
        <circle cx="520" cy="345" r="5" fill="#7fd4c1" />
        <circle cx="850" cy="170" r="7" fill="#f2b33d" />
      </motion.svg>

      <motion.div className="absolute" style={{ left: personX, top: personY, scale: personScale, opacity: personOpacity, x: "-50%", y: "-50%" }}><Person /></motion.div>
      <motion.div className="absolute" style={{ left: satelliteX, top: satelliteY, opacity: satelliteOpacity, x: "-50%", y: "-50%" }}><Satellite /></motion.div>
      <motion.div className="absolute left-[51%] top-[43%] h-3.5 w-3.5 -translate-x-1/2 -translate-y-1/2 rounded-full bg-[#7fd4c1] shadow-[0_0_34px_9px_rgba(127,212,193,.46)]" style={{ opacity: routeOpacity, scale: packetScale }} />
      <motion.div className="absolute left-[51%] top-[43%] h-28 w-28 -translate-x-1/2 -translate-y-1/2 rounded-full border border-[#7fd4c1]/25" style={{ opacity: routeOpacity, scale: routeScale }} />
      <motion.div className="absolute inset-0" style={{ opacity: atmosphereOpacity }}>
        <div className="absolute inset-0 [background-image:linear-gradient(rgba(127,212,193,.045)_1px,transparent_1px),linear-gradient(90deg,rgba(127,212,193,.045)_1px,transparent_1px)] [background-size:80px_80px]" />
        <div className="absolute inset-x-0 top-[8%] h-px bg-gradient-to-r from-transparent via-[#7fd4c1]/30 to-transparent" />
      </motion.div>

      <div className="absolute inset-0 bg-[radial-gradient(circle_at_center,transparent_22%,rgba(2,7,11,.48)_100%)]" />
      <div className="absolute inset-0 bg-[linear-gradient(180deg,rgba(2,7,11,.04),transparent_35%,rgba(2,7,11,.82)_100%)]" />
    </div>
  );
};
