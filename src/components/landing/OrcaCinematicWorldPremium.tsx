import React from "react";
import { motion, useTransform, type MotionValue } from "motion/react";

interface Props { progress: MotionValue<number>; }

const Vessel = () => (
  <svg viewBox="0 0 900 430" className="w-[min(66vw,900px)] overflow-visible" aria-hidden="true">
    <defs>
      <linearGradient id="vxHull" x1="0" x2="1"><stop stopColor="#07131b"/><stop offset=".42" stopColor="#4c8990"/><stop offset=".68" stopColor="#194a55"/><stop offset="1" stopColor="#050c12"/></linearGradient>
      <linearGradient id="vxCabin" x1="0" y1="0" x2="0" y2="1"><stop stopColor="#4d8d92"/><stop offset="1" stopColor="#0a2029"/></linearGradient>
      <linearGradient id="vxWake"><stop stopColor="#eafff9" stopOpacity="0"/><stop offset=".5" stopColor="#b8f5e8" stopOpacity=".85"/><stop offset="1" stopColor="#79cdbd" stopOpacity="0"/></linearGradient>
      <filter id="vxGlow"><feGaussianBlur stdDeviation="7"/></filter>
    </defs>
    <path d="M38 215 L160 275 H650 L844 180 L714 306 H135 Z" fill="url(#vxHull)" stroke="#dcfff8" strokeWidth="3" strokeOpacity=".9"/>
    <path d="M176 215 V91 H492 V215" fill="url(#vxCabin)" stroke="#cffff7" strokeWidth="2.5" strokeOpacity=".78"/>
    <path d="M214 91 V45 H381 V91" fill="#1c4b57" stroke="#d5fff8" strokeWidth="2"/>
    <path d="M382 48 L496 16 V104 H382" fill="#0a1c25" stroke="#d5fff8" strokeWidth="2" strokeOpacity=".7"/>
    <path d="M500 18 V173" stroke="#d5fff8" strokeWidth="3" strokeOpacity=".65"/>
    <path d="M510 31 L580 60 L510 89 Z" fill="#2c626b" stroke="#d5fff8" strokeWidth="2" strokeOpacity=".5"/>
    {[226,268,310,352,394,436].map(x => <rect key={x} x={x} y="122" width="21" height="15" rx="2" fill="#cffff7" fillOpacity=".9"/>)}
    <rect x="448" y="125" width="30" height="19" rx="2" fill="#f4c55d"/>
    <circle cx="263" cy="73" r="8" fill="#f4c55d"/>
    <path d="M0 355 C145 286 230 392 370 332 S610 286 900 362" fill="none" stroke="url(#vxWake)" strokeWidth="18" filter="url(#vxGlow)"/>
    <path d="M0 355 C145 286 230 392 370 332 S610 286 900 362" fill="none" stroke="#e9fff9" strokeOpacity=".48" strokeWidth="6"/>
    <path d="M90 393 C220 350 310 415 432 380 S665 352 835 400" fill="none" stroke="#bdf6eb" strokeOpacity=".2" strokeWidth="4"/>
  </svg>
);

const PersonWithPhone = () => (
  <svg viewBox="0 0 360 520" className="w-[min(23vw,330px)] overflow-visible" aria-hidden="true">
    <circle cx="176" cy="72" r="46" fill="#b88968"/>
    <path d="M132 73 C128 35 151 9 181 10 C215 11 232 39 219 77 C196 51 164 53 132 73Z" fill="#071017"/>
    <path d="M100 245 C101 164 130 122 176 122 C224 122 251 170 254 245 L228 389 H126Z" fill="#123b45" stroke="#baf2e7" strokeOpacity=".5" strokeWidth="2"/>
    <path d="M130 389 L92 492 M225 389 L265 492" stroke="#061016" strokeWidth="38" strokeLinecap="round"/>
    <path d="M119 181 L73 281 M229 180 L277 255" stroke="#1e5661" strokeWidth="29" strokeLinecap="round"/>
    <rect x="250" y="241" width="59" height="105" rx="10" fill="#050c12" stroke="#d0fff6" strokeWidth="2.5"/>
    <rect x="258" y="253" width="43" height="70" rx="5" fill="#0c3440"/>
    <path d="M266 275 H292 M266 288 H287" stroke="#9be6d8" strokeWidth="3" strokeLinecap="round" opacity=".8"/>
    <circle cx="279" cy="332" r="4" fill="#f4c55d"/>
  </svg>
);

const Satellite = () => (
  <svg viewBox="0 0 330 190" className="w-[min(22vw,300px)]" aria-hidden="true">
    <rect x="139" y="62" width="52" height="48" rx="6" fill="#0d2a35" stroke="#d5fff8" strokeWidth="2.5"/>
    <rect x="16" y="49" width="101" height="73" rx="3" fill="#1a4d5b" stroke="#a8eee2" strokeWidth="2.5"/>
    <rect x="213" y="49" width="101" height="73" rx="3" fill="#1a4d5b" stroke="#a8eee2" strokeWidth="2.5"/>
    <path d="M165 62 V20 M165 110 V170 M139 86 H105 M191 86 H225" stroke="#d7fff7" strokeWidth="3" strokeOpacity=".72"/>
    <circle cx="165" cy="86" r="10" fill="#f4c55d"/>
  </svg>
);

export const OrcaCinematicWorldPremium: React.FC<Props> = ({ progress }) => {
  const oceanScale = useTransform(progress, [0, .18, .34, .52], [1.08, 1.16, .96, .7]);
  const horizonY = useTransform(progress, [0, .2, .38, .54], ["60%", "53%", "35%", "11%"]);
  const vesselX = useTransform(progress, [0, .12, .25, .38], ["69%", "64%", "53%", "50%"]);
  const vesselY = useTransform(progress, [0, .1, .23, .36, .47], ["77%", "72%", "57%", "39%", "21%"]);
  const vesselScale = useTransform(progress, [0, .11, .25, .38, .49], [.82, .94, .82, .5, .04]);
  const vesselOpacity = useTransform(progress, [0, .32, .43, .51], [1, 1, .58, 0]);
  const sunOpacity = useTransform(progress, [0, .3, .55], [.95, .55, 0]);
  const atmosphere = useTransform(progress, [.18, .38, .6, .8], [0, .55, 1, .7]);
  const stars = useTransform(progress, [.42, .58, 1], [0, .7, 1]);
  const personOpacity = useTransform(progress, [.51, .59, .82], [0, 1, 1]);
  const personX = useTransform(progress, [.51, .59, .82], ["10%", "18%", "18%"]);
  const satelliteOpacity = useTransform(progress, [.56, .65, .9], [0, 1, 1]);
  const satelliteX = useTransform(progress, [.56, .65, .9], ["94%", "79%", "79%"]);
  const routeOpacity = useTransform(progress, [.52, .61, .96], [0, 1, 1]);
  const packetScale = useTransform(progress, [.57, .67, .78, .9], [.2, 1.2, .75, 1]);
  const packetX = useTransform(progress, [.57, .68, .8, .92], ["18%", "40%", "61%", "79%"]);
  const packetY = useTransform(progress, [.57, .68, .8, .92], ["76%", "59%", "39%", "20%"]);

  return (
    <div className="pointer-events-none fixed inset-0 z-0 overflow-hidden bg-[#02080d]" aria-hidden="true">
      <motion.div className="absolute inset-[-12%]" style={{ scale: oceanScale }}>
        <div className="absolute inset-0 bg-[radial-gradient(ellipse_at_52%_28%,rgba(91,201,195,.34),transparent_40%),linear-gradient(180deg,#061821_0%,#083742_46%,#02080d_100%)]"/>
        <motion.div className="absolute inset-x-[-15%] h-[72%] bg-[radial-gradient(ellipse_at_center,rgba(29,151,156,.8),rgba(5,67,77,.96)_47%,#02080d_82%)]" style={{ top: horizonY }}/>
        <div className="absolute inset-x-[-18%] bottom-[-18%] h-[62%] opacity-70 [background-image:repeating-radial-gradient(ellipse_at_center,rgba(195,250,240,.14)_0_1px,transparent_1px_27px)] [background-size:100%_43px] [transform:perspective(760px)_rotateX(63deg)]"/>
        <div className="absolute inset-0 bg-[linear-gradient(180deg,transparent_28%,rgba(2,8,13,.04)_46%,rgba(2,8,13,.94)_100%)]"/>
      </motion.div>

      <motion.div className="absolute right-[18%] top-[18%] h-52 w-52 rounded-full bg-[#f4c55d]/25 blur-3xl" style={{ opacity: sunOpacity }}/>
      <motion.div className="absolute inset-0" style={{ opacity: atmosphere }}><div className="absolute -left-[10%] top-[12%] h-32 w-[38%] rounded-full bg-white/[.09] blur-3xl"/><div className="absolute left-[22%] top-[23%] h-36 w-[42%] rounded-full bg-white/[.08] blur-3xl"/><div className="absolute right-[-4%] top-[14%] h-32 w-[38%] rounded-full bg-white/[.08] blur-3xl"/><div className="absolute inset-0 bg-[linear-gradient(180deg,rgba(235,252,249,.08),transparent_50%,rgba(2,8,13,.76))]"/></motion.div>
      <motion.div className="absolute inset-0" style={{ opacity: stars }}>{[["7%","13%"],["17%","8%"],["29%","18%"],["42%","10%"],["57%","7%"],["70%","15%"],["88%","9%"],["81%","29%"],["35%","30%"],["63%","27%"]].map(([left,top],i)=><span key={i} className="absolute h-1 w-1 rounded-full bg-white/70 shadow-[0_0_10px_rgba(220,255,247,.7)]" style={{left,top}}/>)}</motion.div>

      <motion.div className="absolute" style={{ left: vesselX, top: vesselY, scale: vesselScale, opacity: vesselOpacity, x: "-50%", y: "-50%" }}><Vessel/></motion.div>

      <motion.div className="absolute inset-0" style={{ opacity: routeOpacity }}>
        <motion.svg className="absolute inset-0 h-full w-full" viewBox="0 0 1400 900" preserveAspectRatio="none">
          <defs><linearGradient id="vxRoute" x1="0" x2="1"><stop stopColor="#7fd4c1" stopOpacity="0"/><stop offset=".5" stopColor="#7fd4c1" stopOpacity=".9"/><stop offset="1" stopColor="#f4c55d" stopOpacity=".95"/></linearGradient></defs>
          <path d="M160 705 C330 580 470 495 615 405 S880 250 1135 145" fill="none" stroke="rgba(255,255,255,.07)" strokeWidth="5"/>
          <path d="M160 705 C330 580 470 495 615 405 S880 250 1135 145" fill="none" stroke="url(#vxRoute)" strokeWidth="3" strokeDasharray="8 17"/>
          <circle cx="160" cy="705" r="10" fill="#7fd4c1"/><circle cx="615" cy="405" r="7" fill="#7fd4c1"/><circle cx="1135" cy="145" r="10" fill="#f4c55d"/>
        </motion.svg>
        <motion.div className="absolute h-5 w-5 -translate-x-1/2 -translate-y-1/2 rounded-full bg-[#9ff0df] shadow-[0_0_44px_15px_rgba(127,212,193,.55)]" style={{ left: packetX, top: packetY, scale: packetScale }}/>
        <motion.div className="absolute h-28 w-28 -translate-x-1/2 -translate-y-1/2 rounded-full border border-[#7fd4c1]/30" style={{ left: packetX, top: packetY, scale: packetScale }}/>
      </motion.div>

      <motion.div className="absolute" style={{ left: personX, top: "61%", opacity: personOpacity, x: "-50%", y: "-50%" }}><PersonWithPhone/></motion.div>
      <motion.div className="absolute" style={{ left: satelliteX, top: "19%", opacity: satelliteOpacity, x: "-50%", y: "-50%" }}><Satellite/></motion.div>
      <div className="absolute inset-0 bg-[radial-gradient(circle_at_center,transparent_18%,rgba(2,8,13,.48)_100%)]"/>
    </div>
  );
};
