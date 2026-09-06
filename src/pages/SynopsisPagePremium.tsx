import React, { useLayoutEffect, useRef } from "react";
import { motion, useScroll, useSpring, useTransform } from "motion/react";
import { ArrowDown, ArrowRight, Compass, MessageCircle, Satellite, Waves } from "lucide-react";
import { OrcaCinematicWorldPremium } from "../components/landing/OrcaCinematicWorldPremium";
import { OrcaGlassCard } from "../components/kokonutui/OrcaGlassCard";
import { OrcaParticleButton } from "../components/kokonutui/OrcaParticleButton";
import { createTimeline, stagger, withMotion } from "../lib/anime";

interface Props { onEnterConsole: () => void; }

const FLOW = [
  ["01", "Ask", "Tell ORCA-X what you need to know."],
  ["02", "Observe", "Look at the ocean around the place that matters."],
  ["03", "Understand", "Bring the changing signals into one picture."],
  ["04", "Predict", "See what the conditions are moving toward."],
  ["05", "Act", "Turn that picture into a clearer next move."],
] as const;

export const SynopsisPagePremium: React.FC<Props> = ({ onEnterConsole }) => {
  const introRef = useRef<HTMLDivElement>(null);
  const { scrollYProgress } = useScroll();
  const progress = useSpring(scrollYProgress, { stiffness: 52, damping: 25, restDelta: 0.001 });

  useLayoutEffect(() => {
    const root = introRef.current;
    if (!root) return;
    const els = root.querySelectorAll<HTMLElement>("[data-enter]");
    return withMotion(() => {
      const tl = createTimeline({ defaults: { ease: "out(4)" } });
      tl.add(els, { opacity: [0, 1], y: [24, 0], duration: 900, delay: stagger(110) });
      return tl;
    }, () => els.forEach((el) => { el.style.opacity = "1"; el.style.transform = "none"; }));
  }, []);

  const phase1 = useTransform(progress, [0, .09, .16], [1, 1, 0]);
  const phase2 = useTransform(progress, [.13, .22, .32, .39], [0, 1, 1, 0]);
  const phase3 = useTransform(progress, [.35, .44, .54, .61], [0, 1, 1, 0]);
  const phase4 = useTransform(progress, [.57, .66, .77, .84], [0, 1, 1, 0]);
  const phase5 = useTransform(progress, [.8, .88, 1], [0, 1, 1]);

  return (
    <div className="relative min-h-[640svh] overflow-x-clip bg-[#02080d] text-[#eef7f4]">
      <OrcaCinematicWorldPremium progress={progress} />
      <header className="fixed inset-x-0 top-0 z-50">
        <div className="mx-auto flex max-w-[1600px] items-center justify-between px-5 py-5 sm:px-8 lg:px-12">
          <button onClick={() => window.scrollTo({ top: 0, behavior: "smooth" })} className="group flex items-center gap-3" aria-label="Back to top">
            <span className="grid h-9 w-9 place-items-center border border-[#8ce0cf]/30 bg-[#071a20]/70 backdrop-blur-xl transition group-hover:border-[#8ce0cf]/70"><Waves className="h-4 w-4 text-[#8ce0cf]"/></span>
            <span className="font-mono text-[10px] font-bold tracking-[.28em]">ORCA-X</span>
          </button>
          <div className="hidden items-center gap-8 md:flex">
            <span className="font-mono text-[8px] uppercase tracking-[.26em] text-white/35">Ocean intelligence / 2026</span>
            <button onClick={onEnterConsole} className="group inline-flex items-center gap-2 font-mono text-[9px] uppercase tracking-[.22em] text-[#8ce0cf]">Live Console <ArrowRight className="h-3 w-3 transition group-hover:translate-x-1"/></button>
          </div>
        </div>
      </header>

      <main className="relative z-10">
        <section ref={introRef} className="relative h-[108svh] px-5 sm:px-8 lg:px-12">
          <motion.div style={{ opacity: phase1 }} className="sticky top-0 flex h-screen items-center">
            <div className="mx-auto w-full max-w-[1600px]">
              <div className="grid items-end gap-10 lg:grid-cols-[1.1fr_.9fr]">
                <div className="max-w-5xl">
                  <div data-enter className="mb-7 flex items-center gap-3 font-mono text-[9px] uppercase tracking-[.38em] text-[#8ce0cf] opacity-0"><span className="h-px w-12 bg-[#8ce0cf]/60"/> Ocean Reasoning &amp; Collaborative AI</div>
                  <h1 className="font-display text-[clamp(4.5rem,11.5vw,11rem)] font-extrabold leading-[.76] tracking-[-.075em]">
                    <span data-enter className="block opacity-0">Read the</span>
                    <span data-enter className="block text-[#8ce0cf] opacity-0">ocean.</span>
                    <span data-enter className="block text-white/86 opacity-0">Before it moves.</span>
                  </h1>
                  <p data-enter className="mt-9 max-w-xl text-base leading-7 text-white/48 opacity-0 sm:text-lg">The sea never stays still. ORCA-X turns changing marine conditions into a clear story you can understand and act on.</p>
                  <div data-enter className="mt-8 flex items-center gap-5 opacity-0">
                    <a href="#voyage" className="group inline-flex items-center gap-3 border border-white/15 bg-white/[.045] px-5 py-3 font-mono text-[9px] uppercase tracking-[.22em] backdrop-blur-xl transition hover:border-[#8ce0cf]/60 hover:bg-[#8ce0cf]/10">Begin the voyage <ArrowDown className="h-3.5 w-3.5 transition group-hover:translate-y-1"/></a>
                    <span className="hidden font-mono text-[8px] uppercase tracking-[.22em] text-white/25 sm:block">Scroll to pull back</span>
                  </div>
                </div>
                <div className="hidden justify-self-end pb-5 lg:block">
                  <div className="w-64 border-l border-white/10 pl-5 font-mono text-[8px] uppercase leading-5 tracking-[.18em] text-white/28"><span className="text-[#8ce0cf]">LIVE / 01</span><br/>A vessel crosses a moving water column.<br/><br/><span className="text-white/45">Wind · wave · visibility</span></div>
                </div>
              </div>
            </div>
          </motion.div>
        </section>

        <section id="voyage" className="relative h-[118svh] px-5 sm:px-8 lg:px-12">
          <motion.div style={{ opacity: phase2 }} className="sticky top-0 flex h-screen items-center">
            <div className="mx-auto w-full max-w-[1600px]">
              <div className="max-w-3xl">
                <div className="mb-5 font-mono text-[9px] uppercase tracking-[.34em] text-[#8ce0cf]">01 / Pull back</div>
                <h2 className="font-display text-[clamp(3.6rem,8vw,8rem)] font-bold leading-[.8] tracking-[-.065em]">Out there,<br/><span className="text-white/38">everything moves.</span></h2>
                <p className="mt-8 max-w-xl text-base leading-7 text-white/48 sm:text-lg">The vessel is only one point in a much larger system. As the view pulls back, the ocean becomes the story.</p>
                <div className="mt-8 flex items-center gap-3 font-mono text-[8px] uppercase tracking-[.22em] text-white/30"><Compass className="h-4 w-4 text-[#8ce0cf]"/> Wind shifts · waves build · visibility changes</div>
              </div>
              <div className="absolute bottom-12 right-5 hidden font-mono text-[8px] uppercase tracking-[.2em] text-white/20 lg:block">02 / atmosphere</div>
            </div>
          </motion.div>
        </section>

        <section className="relative h-[116svh] px-5 sm:px-8 lg:px-12">
          <motion.div style={{ opacity: phase3 }} className="sticky top-0 flex h-screen items-center">
            <div className="mx-auto w-full max-w-[1600px]">
              <div className="grid items-center gap-12 lg:grid-cols-[.8fr_1.2fr]">
                <div className="max-w-md">
                  <div className="mb-5 font-mono text-[9px] uppercase tracking-[.34em] text-[#8ce0cf]">02 / A human asks</div>
                  <h2 className="font-display text-[clamp(3.2rem,6vw,6.5rem)] font-bold leading-[.82] tracking-[-.06em]">Start with<br/><span className="text-white/38">a question.</span></h2>
                  <p className="mt-7 text-sm leading-6 text-white/42">No dashboards to decode first. Ask the question in plain language.</p>
                </div>
                <OrcaGlassCard className="mx-auto w-full max-w-2xl overflow-hidden p-7 sm:p-10">
                  <div className="flex items-center justify-between border-b border-white/10 pb-5 font-mono text-[8px] uppercase tracking-[.2em] text-white/28"><span className="flex items-center gap-2"><MessageCircle className="h-3.5 w-3.5 text-[#8ce0cf]"/> Marine query</span><span className="text-[#8ce0cf]">Ready to send</span></div>
                  <div className="py-12 sm:py-16"><div className="font-display text-[clamp(2rem,4vw,4rem)] font-semibold leading-[.92] tracking-[-.045em]">“What is the marine condition near Digha?”</div></div>
                  <div className="flex items-center justify-between border-t border-white/10 pt-5 font-mono text-[8px] uppercase tracking-[.2em] text-white/25"><span>From a phone</span><span className="flex items-center gap-2 text-[#8ce0cf]">Transmit <ArrowRight className="h-3 w-3"/></span></div>
                </OrcaGlassCard>
              </div>
            </div>
          </motion.div>
        </section>

        <section id="workflow" className="relative h-[150svh] px-5 sm:px-8 lg:px-12">
          <motion.div style={{ opacity: phase4 }} className="sticky top-0 flex h-screen items-center">
            <div className="mx-auto w-full max-w-[1600px]">
              <div className="max-w-4xl">
                <div className="mb-5 font-mono text-[9px] uppercase tracking-[.34em] text-[#8ce0cf]">03 / The signal journey</div>
                <h2 className="font-display text-[clamp(3.5rem,7.4vw,7.5rem)] font-bold leading-[.8] tracking-[-.065em]">One question.<br/><span className="text-[#8ce0cf]">One clear journey.</span></h2>
              </div>
              <div className="relative mt-12">
                <div className="absolute left-[7%] right-[7%] top-1/2 hidden h-px bg-gradient-to-r from-transparent via-[#8ce0cf]/35 to-transparent sm:block"/>
                <div className="grid gap-3 sm:grid-cols-5">{FLOW.map(([n,title,text],i)=><FlowStep key={n} n={n} title={title} text={text} active={i===0}/>)}</div>
              </div>
              <div className="mt-7 flex items-center gap-3 font-mono text-[8px] uppercase tracking-[.2em] text-white/22"><span className="h-1.5 w-1.5 rounded-full bg-[#8ce0cf] shadow-[0_0_14px_#8ce0cf]"/> The technical work stays behind the experience.</div>
            </div>
          </motion.div>
        </section>

        <section className="relative h-[130svh] px-5 sm:px-8 lg:px-12">
          <motion.div style={{ opacity: phase5 }} className="sticky top-0 flex h-screen items-center">
            <div className="mx-auto w-full max-w-[1600px]">
              <div className="relative overflow-hidden border border-white/10 bg-[#07131a]/65 p-8 backdrop-blur-xl sm:p-14 lg:p-20">
                <div className="absolute -right-28 -top-28 h-80 w-80 rounded-full bg-[#8ce0cf]/10 blur-3xl"/>
                <div className="relative max-w-5xl">
                  <div className="mb-5 flex items-center gap-3 font-mono text-[9px] uppercase tracking-[.34em] text-[#8ce0cf]"><Satellite className="h-4 w-4"/> 04 / What comes back</div>
                  <h2 className="font-display text-[clamp(3.5rem,8vw,8rem)] font-bold leading-[.78] tracking-[-.065em]">Not more data.<br/><span className="text-[#8ce0cf]">A better next move.</span></h2>
                  <p className="mt-8 max-w-xl text-base leading-7 text-white/45 sm:text-lg">ORCA-X connects the changing picture to a response that is easier to understand.</p>
                  <div className="mt-9"><OrcaParticleButton onClick={onEnterConsole}>Enter Live Console <ArrowRight className="ml-2 inline h-3.5 w-3.5"/></OrcaParticleButton></div>
                </div>
                <div className="absolute bottom-6 right-7 hidden font-mono text-[8px] uppercase tracking-[.2em] text-white/20 lg:block">Live view → live decision</div>
              </div>
            </div>
          </motion.div>
        </section>
      </main>

      <div className="fixed bottom-5 left-1/2 z-50 flex -translate-x-1/2 items-center gap-3 rounded-full border border-white/10 bg-[#07131a]/65 px-4 py-2 font-mono text-[8px] uppercase tracking-[.18em] text-white/30 backdrop-blur-xl">
        <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-[#8ce0cf]"/> Scroll to explore <span className="text-white/15">/</span> ORCA-X
      </div>
    </div>
  );
};

const FlowStep = ({ n, title, text, active }: { n:string; title:string; text:string; active:boolean }) => (
  <motion.div whileHover={{ y: -6 }} transition={{ type:"spring", stiffness:260, damping:24 }} className="relative border border-white/10 bg-[#07131a]/65 p-5 backdrop-blur-xl sm:min-h-44">
    <div className="flex items-center justify-between font-mono text-[8px] tracking-[.2em] text-white/25"><span>{n}</span>{active && <span className="text-[#8ce0cf]">LIVE</span>}</div>
    <h3 className="mt-10 font-display text-2xl font-semibold tracking-[-.035em]">{title}</h3>
    <p className="mt-3 text-xs leading-5 text-white/38">{text}</p>
  </motion.div>
);

export default SynopsisPagePremium;
