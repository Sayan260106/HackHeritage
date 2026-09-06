import React, { useLayoutEffect, useRef } from "react";
import { motion, useScroll, useSpring, useTransform } from "motion/react";
import { ArrowDown, ArrowRight, CircleDot, Satellite, Waves } from "lucide-react";
import { OrcaCinematicWorldPremium } from "../components/landing/OrcaCinematicWorldPremium";
import { createTimeline, stagger, withMotion } from "../lib/anime";

interface Props { onEnterConsole: () => void; }

const STAGES = [
  ["01", "ASK", "Start with what matters."],
  ["02", "OBSERVE", "See the conditions around it."],
  ["03", "UNDERSTAND", "Bring the changing picture together."],
  ["04", "PREDICT", "See where it is heading."],
  ["05", "ACT", "Choose the clearer next move."],
] as const;

export const SynopsisPagePremium: React.FC<Props> = ({ onEnterConsole }) => {
  const heroRef = useRef<HTMLDivElement>(null);
  const { scrollYProgress } = useScroll();
  const progress = useSpring(scrollYProgress, { stiffness: 48, damping: 24, restDelta: 0.001 });

  useLayoutEffect(() => {
    const root = heroRef.current;
    if (!root) return;
    const els = root.querySelectorAll<HTMLElement>("[data-enter]");
    return withMotion(() => {
      const tl = createTimeline({ defaults: { ease: "out(4)" } });
      tl.add(els, { opacity: [0, 1], y: [20, 0], duration: 850, delay: stagger(105) });
      return tl;
    }, () => els.forEach(el => { el.style.opacity = "1"; el.style.transform = "none"; }));
  }, []);

  const hero = useTransform(progress, [0, .08, .16], [1, 1, 0]);
  const voyage = useTransform(progress, [.11, .21, .32, .39], [0, 1, 1, 0]);
  const ask = useTransform(progress, [.34, .43, .55, .63], [0, 1, 1, 0]);
  const journey = useTransform(progress, [.58, .67, .80, .90], [0, 1, 1, 0]);
  const finale = useTransform(progress, [.86, .94, 1], [0, 1, 1]);

  return (
    <div className="relative min-h-[600svh] overflow-x-clip bg-[#02080d] text-[#eff8f5] selection:bg-[#8ce0cf]/20">
      <OrcaCinematicWorldPremium progress={progress} />
      <header className="fixed inset-x-0 top-0 z-50">
        <div className="mx-auto flex max-w-[1700px] items-center justify-between px-5 py-5 sm:px-8 lg:px-12">
          <button onClick={() => window.scrollTo({ top: 0, behavior: "smooth" })} className="group flex items-center gap-3" aria-label="Back to top">
            <span className="grid h-9 w-9 place-items-center border border-[#8ce0cf]/30 bg-[#06161c]/60 backdrop-blur-xl"><Waves className="h-4 w-4 text-[#8ce0cf]" /></span>
            <span className="font-mono text-[10px] font-bold tracking-[.3em]">ORCA-X</span>
          </button>
          <div className="flex items-center gap-7"><span className="hidden font-mono text-[8px] uppercase tracking-[.26em] text-white/28 md:block">Ocean intelligence / 2026</span><button onClick={onEnterConsole} className="group inline-flex items-center gap-2 font-mono text-[9px] uppercase tracking-[.22em] text-[#8ce0cf]">Live Console <ArrowRight className="h-3 w-3 transition group-hover:translate-x-1" /></button></div>
        </div>
      </header>

      <main className="relative z-10">
        <section ref={heroRef} className="relative h-[116svh] px-5 sm:px-8 lg:px-12">
          <motion.div style={{ opacity: hero }} className="sticky top-0 flex h-screen items-center">
            <div className="mx-auto w-full max-w-[1700px] pt-[14vh] sm:pt-[9vh]">
              <div className="max-w-4xl">
                <div data-enter className="mb-6 flex items-center gap-3 font-mono text-[9px] uppercase tracking-[.36em] text-[#8ce0cf] opacity-0"><span className="h-px w-10 bg-[#8ce0cf]/60" /> Ocean Reasoning &amp; Collaborative AI</div>
                <h1 className="font-display text-[clamp(3.9rem,10.2vw,10.2rem)] font-extrabold leading-[.79] tracking-[-.075em]"><span data-enter className="block opacity-0">Read the</span><span data-enter className="block text-[#8ce0cf] opacity-0">ocean.</span><span data-enter className="block text-white/82 opacity-0">Before it moves.</span></h1>
                <p data-enter className="mt-8 max-w-lg text-[15px] leading-7 text-white/48 opacity-0 sm:text-lg">The sea never stays still. ORCA-X turns changing marine conditions into a clear story you can understand and act on.</p>
                <div data-enter className="mt-7 opacity-0"><a href="#voyage" className="group inline-flex items-center gap-3 border border-white/15 bg-white/[.04] px-5 py-3 font-mono text-[9px] uppercase tracking-[.22em] backdrop-blur-xl transition hover:border-[#8ce0cf]/60 hover:bg-[#8ce0cf]/10">Begin the voyage <ArrowDown className="h-3.5 w-3.5 transition group-hover:translate-y-1" /></a></div>
              </div>
              <div className="absolute bottom-16 right-7 hidden w-44 border-l border-white/10 pl-4 font-mono text-[8px] uppercase leading-5 tracking-[.18em] text-white/23 lg:block"><span className="text-[#8ce0cf]">LIVE / 01</span><br />A vessel in a moving water column.<br /><br /><span className="text-white/38">wind · wave · visibility</span></div>
            </div>
          </motion.div>
        </section>

        <section id="voyage" className="relative h-[118svh] px-5 sm:px-8 lg:px-12">
          <motion.div style={{ opacity: voyage }} className="sticky top-0 flex h-screen items-center">
            <div className="mx-auto w-full max-w-[1700px]"><div className="max-w-4xl lg:ml-[8vw]"><div className="mb-5 font-mono text-[9px] uppercase tracking-[.34em] text-[#8ce0cf]">01 / Pull back</div><h2 className="font-display text-[clamp(3.5rem,8.2vw,8.5rem)] font-bold leading-[.78] tracking-[-.07em]">Out there,<br /><span className="text-white/32">everything moves.</span></h2><p className="mt-8 max-w-lg text-base leading-7 text-white/45 sm:text-lg">The vessel is only one point in a much larger system. Keep moving outward and the ocean becomes the story.</p><div className="mt-7 flex items-center gap-3 font-mono text-[8px] uppercase tracking-[.2em] text-white/25"><CircleDot className="h-4 w-4 text-[#8ce0cf]" /> wind shifts · waves build · visibility changes</div></div></div>
          </motion.div>
        </section>

        <section className="relative h-[130svh] px-5 sm:px-8 lg:px-12">
          <motion.div style={{ opacity: ask }} className="sticky top-0 flex h-screen items-center">
            <div className="mx-auto grid w-full max-w-[1500px] items-center gap-12 lg:grid-cols-[.72fr_1.28fr]"><div className="max-w-xl lg:ml-[5vw]"><div className="mb-5 font-mono text-[9px] uppercase tracking-[.34em] text-[#8ce0cf]">02 / A human asks</div><h2 className="font-display text-[clamp(3.2rem,6.7vw,7rem)] font-bold leading-[.8] tracking-[-.065em]">Start with<br /><span className="text-white/32">a question.</span></h2><p className="mt-7 max-w-md text-sm leading-6 text-white/42 sm:text-base">A person asks what they need to know — in plain language.</p></div><div className="relative mx-auto w-full max-w-2xl lg:mr-[4vw]"><div className="absolute -inset-20 rounded-full bg-[#7fd4c1]/[.055] blur-3xl"/><div className="relative border border-white/13 bg-[#07151b]/42 p-7 shadow-[0_35px_100px_rgba(0,0,0,.35)] backdrop-blur-xl sm:p-10"><div className="flex items-center justify-between border-b border-white/10 pb-5 font-mono text-[8px] uppercase tracking-[.2em] text-white/27"><span>Phone / query</span><span className="text-[#8ce0cf]">Ready to send</span></div><div className="py-12 sm:py-16"><div className="max-w-xl font-display text-[clamp(2rem,4.2vw,4.4rem)] font-semibold leading-[.91] tracking-[-.05em]">“What is the marine condition near Digha?”</div></div><div className="flex items-center justify-between border-t border-white/10 pt-5 font-mono text-[8px] uppercase tracking-[.2em] text-white/24"><span>One question</span><span className="flex items-center gap-2 text-[#8ce0cf]">Transmit <ArrowRight className="h-3 w-3" /></span></div></div></div></div>
          </motion.div>
        </section>

        <section id="workflow" className="relative h-[155svh] px-5 sm:px-8 lg:px-12">
          <motion.div style={{ opacity: journey }} className="sticky top-0 flex h-screen items-center">
            <div className="mx-auto w-full max-w-[1500px]"><div className="max-w-5xl lg:ml-[4vw]"><div className="mb-5 font-mono text-[9px] uppercase tracking-[.34em] text-[#8ce0cf]">03 / The journey</div><h2 className="font-display text-[clamp(3.4rem,7.5vw,7.8rem)] font-bold leading-[.8] tracking-[-.07em]">One question.<br /><span className="text-white/32">One clear journey.</span></h2></div><div className="relative mt-16 max-w-[1320px] lg:ml-[4vw]"><div className="absolute left-[3%] right-[3%] top-[13px] hidden h-px bg-gradient-to-r from-transparent via-[#7fd4c1]/45 to-[#f4c55d]/45 md:block"/><div className="grid gap-10 md:grid-cols-5 md:gap-0">{STAGES.map(([number,title,text],index)=><JourneyStage key={number} number={number} title={title} text={text} index={index}/>)}</div></div><div className="mt-16 max-w-xl font-mono text-[8px] uppercase tracking-[.2em] text-white/23"><span className="mr-3 inline-block h-1.5 w-1.5 rounded-full bg-[#8ce0cf] shadow-[0_0_14px_#8ce0cf]"/>The complexity stays behind the experience.</div></div>
          </motion.div>
        </section>

        <section className="relative h-[124svh] px-5 sm:px-8 lg:px-12"><motion.div style={{ opacity: finale }} className="sticky top-0 flex h-screen items-center"><div className="mx-auto w-full max-w-[1500px]"><div className="relative overflow-hidden border border-white/10 bg-[#06131a]/52 p-8 backdrop-blur-xl sm:p-14 lg:p-20"><div className="absolute -right-40 -top-40 h-[34rem] w-[34rem] rounded-full bg-[#7fd4c1]/10 blur-3xl"/><div className="absolute bottom-0 right-0 h-px w-2/3 bg-gradient-to-l from-[#f4c55d]/55 to-transparent"/><div className="relative max-w-6xl"><div className="mb-6 flex items-center gap-3 font-mono text-[9px] uppercase tracking-[.34em] text-[#8ce0cf]"><Satellite className="h-4 w-4"/>04 / What comes back</div><h2 className="font-display text-[clamp(3.5rem,8.2vw,8.8rem)] font-bold leading-[.76] tracking-[-.075em]">Not more data.<br/><span className="text-[#8ce0cf]">A better next move.</span></h2><p className="mt-9 max-w-xl text-base leading-7 text-white/43 sm:text-lg">ORCA-X connects the changing picture to a response that is easier to understand — and easier to act on.</p><button onClick={onEnterConsole} className="group mt-10 inline-flex items-center gap-4 border border-[#8ce0cf]/45 bg-[#8ce0cf]/[.08] px-6 py-4 font-mono text-[9px] uppercase tracking-[.24em] text-[#bdf7eb] transition hover:border-[#8ce0cf] hover:bg-[#8ce0cf]/[.14]">Enter Live Console <ArrowRight className="h-4 w-4 transition group-hover:translate-x-1.5"/></button></div><div className="absolute bottom-7 right-8 hidden font-mono text-[8px] uppercase tracking-[.2em] text-white/18 lg:block">Live view → live decision</div></div></div></motion.div></section>
      </main>
      <div className="fixed bottom-5 left-1/2 z-50 flex -translate-x-1/2 items-center gap-3 rounded-full border border-white/10 bg-[#06131a]/65 px-4 py-2 font-mono text-[8px] uppercase tracking-[.18em] text-white/27"><span className="h-1.5 w-1.5 animate-pulse rounded-full bg-[#8ce0cf]"/>Scroll to explore <span className="text-white/15">/</span> ORCA-X</div>
    </div>
  );
};

const JourneyStage = ({ number,title,text,index }: { number:string; title:string; text:string; index:number }) => (<motion.div initial={{opacity:0,y:18}} whileInView={{opacity:1,y:0}} viewport={{once:true,amount:.35}} transition={{duration:.6,delay:index*.08}} className="relative pr-7 md:min-h-48 md:border-l md:border-white/10 md:pl-6"><div className="relative z-10 mb-6 grid h-5 w-5 place-items-center rounded-full border border-[#7fd4c1]/55 bg-[#06131a] shadow-[0_0_20px_rgba(127,212,193,.16)]"><span className="h-1.5 w-1.5 rounded-full bg-[#7fd4c1]"/></div><div className="font-mono text-[8px] tracking-[.2em] text-white/25">{number}</div><h3 className="mt-4 font-display text-[clamp(1.7rem,2.7vw,2.6rem)] font-semibold tracking-[-.045em]">{title}</h3><p className="mt-3 max-w-[190px] text-xs leading-5 text-white/35">{text}</p></motion.div>);

export default SynopsisPagePremium;
