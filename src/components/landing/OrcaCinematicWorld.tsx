import React from "react";
import { motion, useTransform, type MotionValue } from "motion/react";

interface OrcaCinematicWorldProps { progress: MotionValue<number>; }

const Cloud = ({ x, y, width = 280, scale = 1 }: { x: string; y: string; width?: number; scale?: number }) => (
  <div className="absolute h-20 rounded-full bg-white/[0.08] blur-3xl" style={{ left: x, top: y, width, transform: `scale(${scale})` }} />
);

const Vessel = () => (
  <svg width="340" height="150" viewBox="0 0 340 150" className="overflow-visible drop-shadow-[0_20px_32px_rgba(0,0,0,.6)]">
    <defs><linearGradient id="orca-hull" x1="0" x2="1"><stop offset="0" stopColor="#07151d"/><stop offset=".55" stopColor="#17404d"/><stop offset="1" stopColor="#07151d"/></linearGradient></defs>
    <path d="M34 86 L72 106 H260 L305 82 L273 120 H65 Z" fill="url(#orca-hull)" stroke="#9ce8d7" strokeOpacity=".75" strokeWidth="1.5"/>
    <path d="M78 88 V45 H184 V88" fill="#0b202a" stroke="#9ce8d7" strokeOpacity=".55"/>
    <path d="M96 45 V27 H155 V45" fill="#153746" stroke="#9ce8d7" strokeOpacity=".5"/>
    <path d="M156 29 L201 13 V48 H156" fill="#091922" stroke="#9ce8d7" strokeOpacity=".45"/>
    <path d="M200 14 V70" stroke="#9ce8d7" strokeOpacity=".45"/>
    <path d="M207 18 L236 30 L207 40 Z" fill="#173a48" stroke="#9ce8d7" strokeOpacity=".38"/>
    <path d="M0 128 C60 111 96 140 151 127 S247 112 340 131" fill="none" stroke="#7fd4c1" strokeOpacity=".38" strokeWidth="4"/>
    <path d="M37 130 C79 121 112 140 164 130" fill="none" stroke="#d7f5ee" strokeOpacity=".22" strokeWidth="2"/>
    {[112,132,152].map((cx) => <rect key={cx} x={cx} y="55" width="9" height="7" rx="1" fill="#8de4d2" fillOpacity=".45"/>)}
    <circle cx="126" cy="48" r="4" fill="#f2b33d" className="animate-pulse"/>
  </svg>
);

const Person = () => (
  <svg width="250" height="360" viewBox="0 0 250 360" className="overflow-visible drop-shadow-[0_25px_40px_rgba(0,0,0,.5)]">
    <circle cx="126" cy="61" r="31" fill="#b88968"/><path d="M95 61 C94 35 110 23 128 23 C151 24 164 40 158 62 C145 47 123 48 95 61Z" fill="#101419"/>
    <path d="M77 178 C80 128 96 103 126 103 C156 103 174 130 177 178 L161 285 H91 Z" fill="#102d39" stroke="#8fdccd" strokeOpacity=".28"/>
    <path d="M92 285 L70 349 M158 285 L184 349" stroke="#0a151c" strokeWidth="28" strokeLinecap="round"/>
    <path d="M92 150 L57 213 M162 151 L191 204" stroke="#163b47" strokeWidth="22" strokeLinecap="round"/>
    <rect x="171" y="192" width="39" height="70" rx="7" fill="#071117" stroke="#7fd4c1" strokeOpacity=".72"/><rect x="177" y="199" width="27" height="48" rx="3" fill="#0b2a32"/><circle cx="190.5" cy="254" r="2.5" fill="#f2b33d"/>
  </svg>
);

const Satellite = () => (
  <svg width="170" height="105" viewBox="0 0 170 105" className="drop-shadow-[0_0_24px_rgba(127,212,193,.28)]">
    <rect x="72" y="35" width="35" height="27" rx="4" fill="#102934" stroke="#9ce8d7" strokeOpacity=".7"/><rect x="20" y="29" width="45" height="35" rx="2" fill="#183d4b" stroke="#7fd4c1" strokeOpacity=".5"/><rect x="109" y="29" width="45" height="35" rx="2" fill="#183d4b" stroke="#7fd4c1" strokeOpacity=".5"/><path d="M89 35 V12 M89 62 V91 M72 48 H49 M107 48 H130" stroke="#b8ebe2" strokeOpacity=".55"/><circle cx="89" cy="48" r="6" fill="#f2b33d"/>
  </svg>
);

export const OrcaCinematicWorld: React.FC<OrcaCinematicWorldProps> = ({ progress }) => {
  const oceanScale = useTransform(progress, [0,.2,.42], [1.18,1.03,.76]);
  const horizonY = useTransform(progress, [0,.2,.42], ["50%","40%","22%"]);
  const horizonOpacity = useTransform(progress, [0,.28,.5,.64], [1,1,.55,0]);
  const vesselX = useTransform(progress, [0,.2,.36], ["51%","53%","57%");
  const vesselY = useTransform(progress, [0,.2,.38,.5], ["68%","66%","52%","30%");
  const vesselScale = useTransform(progress, [0,.2,.38,.5], [.95,1.05,.72,.24]);
  const vesselOpacity = useTransform(progress, [0,.34,.48,.58], [1,1,.55,0]);
  const cloudOpacity = useTransform(progress, [.18,.36,.58,.72], [0,.7,1,.4]);
  const starsOpacity = useTransform(progress, [.52,.7,1], [0,.75,1]);
  const personOpacity = useTransform(progress, [.54,.64,.86], [0,1,1]);
  const personX = useTransform(progress, [.54,.64,.86], ["-15%","19%","19%");
  const personY = useTransform(progress, [.54,.64,.86], ["62%","56%","53%");
  const personScale = useTransform(progress, [.54,.64,.86], [.5,.92,1]);
  const satelliteOpacity = useTransform(progress, [.58,.68,.9], [0,1,1]);
  const satelliteX = useTransform(progress, [.58,.68,.9], ["91%","72%","77%");
  const satelliteY = useTransform(progress, [.58,.68,.9], ["15%","21%","20%");
  const routeOpacity = useTransform(progress, [.56,.68,.96], [0,1,1]);
  const packetScale = useTransform(progress, [.56,.66,.78,.92], [.3,1,.7,1.2]);

  return <div aria-hidden="true" className="pointer-events-none fixed inset-0 z-0 overflow-hidden bg-[#02070b]">
    <motion.div className="absolute inset-[-16%]" style={{scale:oceanScale}}>
      <div className="absolute inset-0 bg-[radial-gradient(ellipse_at_50%_34%,rgba(73,158,165,.32),transparent_42%),linear-gradient(180deg,#06131c_0%,#04151e_48%,#02070b_100%)]"/>
      <motion.div className="absolute inset-x-[-12%] h-[68%] bg-[radial-gradient(ellipse_at_center,rgba(26,111,126,.62),rgba(4,34,45,.92)_48%,#02070b_78%)]" style={{top:horizonY}}/>
      <div className="absolute inset-x-[-15%] bottom-[-10%] h-[55%] opacity-80 [background-image:repeating-radial-gradient(ellipse_at_center,rgba(127,212,193,.12)_0_1px,transparent_1px_22px)] [background-size:100%_34px] [transform:perspective(600px)_rotateX(62deg)]"/>
      <motion.div className="absolute inset-0 bg-[linear-gradient(180deg,transparent,rgba(127,212,193,.04)_45%,rgba(2,7,11,.88))]" style={{opacity:horizonOpacity}}/>
    </motion.div>

    <motion.div className="absolute inset-0" style={{opacity:cloudOpacity}}>
      <Cloud x="-8%" y="14%" width={360} scale={1.4}/><Cloud x="18%" y="24%" width={420} scale={1.1}/><Cloud x="58%" y="12%" width={390} scale={1.3}/><Cloud x="78%" y="29%" width={330} scale={1.2}/>
      <div className="absolute inset-0 bg-[linear-gradient(180deg,rgba(218,244,240,.1),transparent_52%,rgba(2,7,11,.9))]"/>
    </motion.div>

    <motion.div className="absolute inset-0" style={{opacity:starsOpacity}}>
      {[['8%','16%'],['27%','10%'],['44%','19%'],['63%','9%'],['91%','14%']].map(([left,top],i)=><span key={i} className="absolute h-1 w-1 rounded-full bg-[#d7f5ee]/60" style={{left,top}}/>)}
    </motion.div>

    <motion.div className="absolute" style={{left:vesselX,top:vesselY,scale:vesselScale,opacity:vesselOpacity,x:'-50%',y:'-50%'}}><Vessel/></motion.div>

    <motion.svg className="absolute inset-0 h-full w-full" viewBox="0 0 1200 800" preserveAspectRatio="none" style={{opacity:routeOpacity}}>
      <defs><linearGradient id="orca-route" x1="0" x2="1"><stop offset="0" stopColor="#7fd4c1" stopOpacity="0"/><stop offset=".45" stopColor="#7fd4c1" stopOpacity=".72"/><stop offset="1" stopColor="#f2b33d" stopOpacity=".75"/></linearGradient></defs>
      <path d="M170 610 C330 500 405 420 520 345 C635 270 720 220 850 170" fill="none" stroke="rgba(255,255,255,.08)" strokeWidth="2"/><path d="M170 610 C330 500 405 420 520 345 C635 270 720 220 850 170" fill="none" stroke="url(#orca-route)" strokeWidth="2" strokeDasharray="5 13"/>
      <circle cx="170" cy="610" r="7" fill="#7fd4c1"/><circle cx="520" cy="345" r="5" fill="#7fd4c1"/><circle cx="850" cy="170" r="7" fill="#f2b33d"/>
    </motion.svg>

    <motion.div className="absolute" style={{left:personX,top:personY,scale:personScale,opacity:personOpacity,x:'-50%',y:'-50%'}}><Person/></motion.div>
    <motion.div className="absolute" style={{left:satelliteX,top:satelliteY,opacity:satelliteOpacity,x:'-50%',y:'-50%'}}><Satellite/></motion.div>
    <motion.div className="absolute left-[51%] top-[43%] h-3 w-3 -translate-x-1/2 -translate-y-1/2 rounded-full bg-[#7fd4c1] shadow-[0_0_30px_8px_rgba(127,212,193,.4)]" style={{opacity:routeOpacity,scale:packetScale}}/>
    <motion.div className="absolute left-[51%] top-[43%] h-28 w-28 -translate-x-1/2 -translate-y-1/2 rounded-full border border-[#7fd4c1]/20" style={{opacity:routeOpacity,scale:useTransform(progress,[.56,1],[.4,3.2])}}/>
    <motion.div className="absolute inset-0" style={{opacity:useTransform(progress,[.42,.68,1],[0,.4,1])}}><div className="absolute inset-0 [background-image:linear-gradient(rgba(127,212,193,.05)_1px,transparent_1px),linear-gradient(90deg,rgba(127,212,193,.05)_1px,transparent_1px)] [background-size:80px_80px]"/></motion.div>
    <div className="absolute inset-0 bg-[radial-gradient(circle_at_center,transparent_26%,rgba(2,7,11,.62)_100%)]"/><div className="absolute inset-0 bg-[linear-gradient(180deg,rgba(2,7,11,.08),transparent_34%,rgba(2,7,11,.94)_100%)]"/>
  </div>;
};
