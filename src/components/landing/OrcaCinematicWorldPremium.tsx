import React from "react";
import { motion, useTransform, type MotionValue } from "motion/react";

interface Props { progress: MotionValue<number>; }

const Ship = () => (
  <svg viewBox="0 0 720 320" className="w-[min(58vw,720px)] overflow-visible drop-shadow-[0_34px_55px_rgba(0,0,0,.72)]" aria-hidden="true">
    <defs>
      <linearGradient id="shipHull" x1="0" x2="1"><stop offset="0" stopColor="#081923"/><stop offset=".46" stopColor="#3c7f88"/><stop offset=".75" stopColor="#153c49"/><stop offset="1" stopColor="#061018"/></linearGradient>
      <linearGradient id="shipCabin" x1="0" y1="0" x2="0" y2="1"><stop stopColor="#3b7882"/><stop offset="1" stopColor="#0a202b"/></linearGradient>
      <linearGradient id="wake" x1="0" x2="1"><stop stopColor="#e7fff9" stopOpacity="0"/><stop offset=".35" stopColor="#bff8eb" stopOpacity=".7"/><stop offset="1" stopColor="#7fd4c1" stopOpacity="0"/></linearGradient>
    </defs>
    <path d="M54 164 L132 202 H546 L674 145 L592 229 H112 Z" fill="url(#shipHull)" stroke="#d7fff7" strokeWidth="2.2" strokeOpacity=".9"/>
    <path d="M153 164 V75 H407 V164" fill="url(#shipCabin)" stroke="#c9f9f1" strokeWidth="2" strokeOpacity=".72"/>
    <path d="M193 75 V38 H326 V75" fill="#174553" stroke="#d1fff8" strokeOpacity=".7" strokeWidth="1.8"/>
    <path d="M327 40 L413 13 V82 H327" fill="#0b1d27" stroke="#d1fff8" strokeOpacity=".55" strokeWidth="2"/>
    <path d="M415 17 V131" stroke="#d1fff8" strokeOpacity=".55" strokeWidth="3"/>
    <path d="M423 26 L485 51 L423 76 Z" fill="#275e69" stroke="#d1fff8" strokeOpacity=".45"/>
    {[205,244,283,322,361].map((x) => <rect key={x} x={x} y="101" width="17" height="12" rx="2" fill="#c5fff4" fillOpacity=".84"/>)}
    <rect x="371" y="103" width="26" height="15" rx="2" fill="#f6c45d"/>
    <circle cx="239" cy="67" r="7" fill="#f6c45d" className="animate-pulse"/>
    <path d="M0 252 C102 207 160 277 262 241 S468 209 720 255" fill="none" stroke="url(#wake)" strokeWidth="11"/>
    <path d="M34 274 C132 240 197 294 302 265 S505 238 662 280" fill="none" stroke="#e9fff9" strokeOpacity=".28" strokeWidth="5"/>
  </svg>
);

const Person = () => (
  <svg viewBox="0 0 300 430" className="w-[min(20vw,300px)] overflow-visible drop-shadow-[0_30px_45px_rgba(0,0,0,.62)]" aria-hidden="true">
    <circle cx="150" cy="62" r="38" fill="#b88968"/>
    <path d="M113 63 C111 30 131 10 155 10 C183 12 200 31 191 64 C172 45 145 46 113 63Z" fill="#0a1116"/>
    <path d="M89 205 C92 143 116 111 150 111 C185 111 210 147 214 205 L195 324 H105Z" fill="#143943" stroke="#b8eee4" strokeOpacity=".38" strokeWidth="2"/>
    <path d="M107 323 L78 407 M194 323 L225 407" stroke="#07131a" strokeWidth="32" strokeLinecap="round"/>
    <path d="M106 166 L61 244 M195 166 L236 232" stroke="#1c505c" strokeWidth="25" strokeLinecap="round"/>
    <rect x="208" y="219" width="48" height="83" rx="8" fill="#061017" stroke="#b8eee4" strokeWidth="2"/>
    <rect x="216" y="228" width="32" height="57" rx="4" fill="#0d3540"/>
    <circle cx="232" cy="291" r="3" fill="#f6c45d"/>
  </svg>
);

const Satellite = () => (
  <svg viewBox="0 0 280 170" className="w-[min(22vw,280px)] drop-shadow-[0_0_40px_rgba(127,212,193,.32)]" aria-hidden="true">
    <rect x="117" y="58" width="48" height="40" rx="5" fill="#102d39" stroke="#d4fff7" strokeWidth="2"/>
    <rect x="15" y="47" width="82" height="62" rx="3" fill="#1b4c5a" stroke="#a7eee1" strokeWidth="2"/>
    <rect x="183" y="47" width="82" height="62" rx="3" fill="#1b4c5a" stroke="#a7eee1" strokeWidth="2"/>
    <path d="M141 58 V20 M141 98 V150 M117 78 H83 M165 78 H199" stroke="#d7fff7" strokeWidth="2.5" strokeOpacity=".72"/>
    <circle cx="141" cy="78" r="9" fill="#f6c45d"/>
  </svg>
);

export const OrcaCinematicWorldPremium: React.FC<Props> = ({ progress }) => {
  const sea = useTransform(progress, [0, .22, .42, .58], [1.12, 1.06, .92, .68]);
  const horizon = useTransform(progress, [0, .18, .4, .58], ["58%", "50%", "34%", "15%"]);
  const shipY = useTransform(progress, [0, .14, .29, .44, .53], ["67%", "65%", "53%", "35%", "20%"]);
  const shipScale = useTransform(progress, [0, .12, .28, .44, .53], [1.05, 1.12, .88, .48, .08]);
  const shipOpacity = useTransform(progress, [0, .37, .5, .56], [1, 1, .55, 0]);
  const clouds = useTransform(progress, [.18, .36, .6, .8], [0, .45, 1, .7]);
  const stars = useTransform(progress, [.45, .62, 1], [0, .65, 1]);
  const personOpacity = useTransform(progress, [.54, .63, .84], [0, 1, 1]);
  const personX = useTransform(progress, [.54, .63, .84], ["8%", "22%", "22%"]);
  const satelliteOpacity = useTransform(progress, [.58, .69, .9], [0, 1, 1]);
  const satelliteX = useTransform(progress, [.58, .69, .9], ["96%", "78%", "78%"]);
  const routeOpacity = useTransform(progress, [.55, .64, .95], [0, 1, 1]);
  const packet = useTransform(progress, [.58, .68, .78, .9], [0, 1, .7, 1]);
  const routeScale = useTransform(progress, [.56, 1], [.5, 2.7]);
  const sun = useTransform(progress, [0, .28, .52], [.9, .7, 0]);

  return (
    <div className="pointer-events-none fixed inset-0 z-0 overflow-hidden bg-[#02080d]" aria-hidden="true">
      <motion.div className="absolute inset-[-14%]" style={{ scale: sea }}>
        <div className="absolute inset-0 bg-[radial-gradient(ellipse_at_50%_34%,rgba(84,189,187,.32),transparent_42%),linear-gradient(180deg,#061923_0%,#07313b_48%,#02080d_100%)]"/>
        <motion.div className="absolute inset-x-[-10%] h-[72%] bg-[radial-gradient(ellipse_at_center,rgba(31,146,151,.78),rgba(5,62,73,.96)_48%,#02080d_80%)]" style={{ top: horizon }}/>
        <div className="absolute inset-x-[-15%] bottom-[-15%] h-[60%] opacity-80 [background-image:repeating-radial-gradient(ellipse_at_center,rgba(188,246,235,.16)_0_1px,transparent_1px_25px)] [background-size:100%_42px] [transform:perspective(720px)_rotateX(64deg)]"/>
        <div className="absolute inset-0 bg-[linear-gradient(180deg,transparent_32%,rgba(2,8,13,.08)_48%,rgba(2,8,13,.92)_100%)]"/>
      </motion.div>
      <motion.div className="absolute right-[17%] top-[17%] h-40 w-40 rounded-full bg-[#f6c45d]/25 blur-3xl" style={{ opacity: sun }}/>
      <motion.div className="absolute inset-0" style={{ opacity: clouds }}>
        <div className="absolute -left-[8%] top-[13%] h-28 w-[34%] rounded-full bg-white/[.09] blur-3xl"/>
        <div className="absolute left-[18%] top-[25%] h-32 w-[42%] rounded-full bg-white/[.08] blur-3xl"/>
        <div className="absolute right-[2%] top-[15%] h-28 w-[35%] rounded-full bg-white/[.08] blur-3xl"/>
        <div className="absolute inset-0 bg-[linear-gradient(180deg,rgba(232,250,247,.08),transparent_48%,rgba(2,8,13,.72))]"/>
      </motion.div>
      <motion.div className="absolute inset-0" style={{ opacity: stars }}>
        {[["7%","15%"],["17%","8%"],["29%","19%"],["43%","11%"],["58%","7%"],["70%","16%"],["88%","9%"],["81%","29%"],["35%","31%"]].map(([left,top],i)=><span key={i} className="absolute h-1 w-1 rounded-full bg-white/70 shadow-[0_0_10px_rgba(220,255,247,.7)]" style={{left,top}}/>)}
      </motion.div>
      <motion.div className="absolute left-1/2" style={{ top: shipY, scale: shipScale, opacity: shipOpacity, x: "-50%", y: "-50%" }}><Ship/></motion.div>
      <motion.svg className="absolute inset-0 h-full w-full" viewBox="0 0 1400 900" preserveAspectRatio="none" style={{ opacity: routeOpacity }}>
        <defs><linearGradient id="premiumRoute" x1="0" x2="1"><stop stopColor="#7fd4c1" stopOpacity="0"/><stop offset=".5" stopColor="#7fd4c1" stopOpacity=".85"/><stop offset="1" stopColor="#f6c45d" stopOpacity=".9"/></linearGradient></defs>
        <path d="M170 690 C350 560 475 470 620 390 S890 245 1120 160" fill="none" stroke="rgba(255,255,255,.08)" strokeWidth="3"/>
        <path d="M170 690 C350 560 475 470 620 390 S890 245 1120 160" fill="none" stroke="url(#premiumRoute)" strokeWidth="2.5" strokeDasharray="7 16"/>
        <circle cx="170" cy="690" r="9" fill="#7fd4c1"/><circle cx="620" cy="390" r="6" fill="#7fd4c1"/><circle cx="1120" cy="160" r="9" fill="#f6c45d"/>
      </motion.svg>
      <motion.div className="absolute" style={{ left: personX, top: "58%", opacity: personOpacity, x: "-50%", y: "-50%" }}><Person/></motion.div>
      <motion.div className="absolute" style={{ left: satelliteX, top: "19%", opacity: satelliteOpacity, x: "-50%", y: "-50%" }}><Satellite/></motion.div>
      <motion.div className="absolute left-[44%] top-[47%] h-4 w-4 -translate-x-1/2 -translate-y-1/2 rounded-full bg-[#7fd4c1] shadow-[0_0_36px_12px_rgba(127,212,193,.48)]" style={{ opacity: routeOpacity, scale: packet }}/>
      <motion.div className="absolute left-[44%] top-[47%] h-24 w-24 -translate-x-1/2 -translate-y-1/2 rounded-full border border-[#7fd4c1]/30" style={{ opacity: routeOpacity, scale: routeScale }}/>
      <div className="absolute inset-0 bg-[radial-gradient(circle_at_center,transparent_18%,rgba(2,8,13,.44)_100%)]"/>
      <div className="absolute inset-x-0 bottom-0 h-1/3 bg-gradient-to-t from-[#02080d] to-transparent"/>
      <div className="absolute inset-0 opacity-30 [background-image:linear-gradient(rgba(127,212,193,.035)_1px,transparent_1px),linear-gradient(90deg,rgba(127,212,193,.035)_1px,transparent_1px)] [background-size:96px_96px]"/>
    </div>
  );
};
