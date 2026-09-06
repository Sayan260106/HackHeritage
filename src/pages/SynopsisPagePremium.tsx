import React, { useLayoutEffect, useRef } from "react";
import { motion, useScroll, useSpring, useTransform } from "motion/react";
import { ArrowDown, ArrowRight, Compass, MessageCircle, Satellite, Waves } from "lucide-react";
import { OrcaCinematicWorldPremium } from "../components/landing/OrcaCinematicWorldPremium";
import { createTimeline, stagger, withMotion } from "../lib/anime";

interface Props { onEnterConsole: () => void; }

const STAGES = [
  ["01", "ASK", "Start with what matters."],
  ["02", "OBSERVE", "See the conditions around it."],
  ["03", "UNDERSTAND", "Bring the changing picture together."],
  ["04", "PREDICT", "See where the conditions are heading."],
  ["05", "ACT", "Choose the clearer next move."],
] as const;

export const SynopsisPagePremium: React.FC<Props> = ({ onEnterConsole }) => {
  const introRef = useRef<HTMLDivElement>(null);
  const { scrollYProgress } = useScroll();
  const progress = useSpring(scrollYProgress, { stiffness: 55, damping: 26, restDelta: 0.001 });

  useLayoutEffect(() => {
    const root = introRef.current;
    if (!root) return;
    const els = root.querySelectorAll<HTMLElement>("[data-enter]");
    return withMotion(() => {
      const tl = createTimeline({ defaults: { ease: "out(4)" } });
      tl.add(els, { opacity: [0, 1], y: [30, 0], duration: 950, delay: stagger(120) });
      return tl;
    }, () => els.forEach(el => { el.style.opacity = "1"; el.style.transform = "none"; }));
  }, []);

  const hero = useTransform(progress, [0, .08, .15], [1, 1, 0]);
  const pullback = useTransform(progress, [.10, .22, .34, .42], [0, 1, 1, 0]);
  const question = useTransform(progress, [.38, .48, .59, .65], [0, 1, 1, 0]);
  const journey = useTransform(progress, [.61, .70, .82, .9], [0, 1, 1, 0]);
  const finale = useTransform(progress, [.86, .94, 1], [0, 1, 1]);

  return (
    <div className="relative min-h-[620svh] overflow-x-clip bg-[#02080d] text-[#eff8f5] selection:bg-[#8ce0cf]/20">
      <OrcaCinematicWorldPremium progress={progress} />

      <header className="fixed inset-x-0 top-0 z-50">
        <div className="mx-auto flex max-w-[1700px] items-center justify-between px-5 py-5 sm:px-8 lg:px-12">
          <button onClick={() => window.scrollTo({ top: 0, behavior: "smooth" })} className="group flex items-center gap-3" aria-label="Back to top">
            <span className="grid h-9 w-9 place-items-center border border-[#8ce0cf]/35 bg-[#06161c]/55 backdrop-blur-xl transition group-hover:border-[#8ce0cf]/80"><Waves className="h-4 w-4 text-[#8ce0cf]" /></span>
            <span className="font-mono text-[10px] font-bold tracking-[.3em]">ORCA-X</span>
          </button>
          <div className="flex items-center gap-6">
            <span className="hidden font-mono text-[8px] uppercase tracking-[.26em] text-white/30 md:block">Ocean intelligence / 2026</span>
            <button onClick={onEnterConsole} className="group inline-flex items-center gap-2 font-mono text-[9px] uppercase tracking-[.22em] text-[#8ce0cf]">Live Console <ArrowRight className="h-3 w-3 transition group-hover:translate-x-1" /></button>
          </div>
        </div>
      </header>

      <main className="relative z-10">
        <section ref={introRef} className="relative h-[112svh] px-5 sm:px-8 lg:px-12">
          <motion.div style={{ opacity: hero }} className="sticky top-0 flex h-screen items-center">
            <div className="mx-auto w-full max-w-[1700px] pt-16 sm:pt-20">
              <div className="max-w-6xl">
                <div data-enter className="mb-7 flex items-center gap-3 font-mono text-[9px] uppercase tracking-[.38em] text-[#8ce0cf] opacity-0"><span className="h-px w-12 bg-[#8ce0cf]/65" /> Ocean Reasoning &amp; Collaborative AI</div>
                <h1 className="font-display text-[clamp(4rem,11vw,11rem)] font-extrabold leading-[.78] tracking-[-.075em]">
                  <span data-enter className="block opacity-0">Read the</span>
                  <span data-enter className="block text-[#8ce0cf] opacity-0">ocean.</span>
                  <span data-enter className="block text-white/85 opacity-0">Before it moves.</span>
                </h1>
                <p data-enter className="mt-9 max-w-xl text-[15px] leading-7 text-white/48 opacity-0 sm:text-lg">The sea never stays still. ORCA-X turns changing marine conditions into a clear story you can understand and act on.</p>
                <div data-enter className="mt-8 flex items-center gap-5 opacity-0">
                  <a href="#voyage" className="group inline-flex items-center gap-3 border border-white/15 bg-white/[.045] px-5 py-3 font-mono text-[9px] uppercase tracking-[.22em] backdrop-blur-xl transition hover:border-[#8ce0cf]/65 hover:bg-[#8ce0cf]/10">Begin the voyage <ArrowDown className="h-3.5 w-3.5 transition group-hover:translate-y-1" /></a>
                  <span className="hidden font-mono text-[8px] uppercase tracking-[.22em] text-white/25 sm:block">Scroll to pull back</span>
                </div>
              </div>
              <div className="absolute bottom-14 right-6 hidden w-52 border-l border-white/10 pl-5 font-mono text-[8px] uppercase leading-5 tracking-[.18em] text-white/25 lg:block"><span className="text-[#8ce0cf]">LIVE / 01</span><br />A vessel crosses a moving water column.<br /><br /><span className="text-white/40">Wind · wave · visibility</span></div>
            </div>
          </motion.div>
        </section>

        <section id="voyage" className="relative h-[118svh] px-5 sm:px-8 lg:px-12">
          <motion.div style={{ opacity: pullback }} className="sticky top-0 flex h-screen items-center">
            <div className="mx-auto w-full max-w-[1700px]">
              <div className="max-w-4xl">
                <div className="mb-5 font-mono text-[9px] uppercase tracking-[.34em] text-[#8ce0cf]">01 / Pull back</div>
                <h2 className="font-display text-[clamp(3.5rem,8.5vw,8.8rem)] font-bold leading-[.78] tracking-[-.07em]">Out there,<br /><span className="text-white/35">everything moves.</span></h2>
                <p className="mt-8 max-w-xl text-base leading-7 text-white/46 sm:text-lg">The vessel is only one point in a much larger system. Keep moving outward and the ocean becomes the story.</p>
                <div className="mt-8 flex items-center gap-3 font-mono text-[8px] uppercase tracking-[.22em] text-white/28"><Compass className="h-4 w-4 text-[#8ce0cf]" /> Wind shifts · waves build · visibility changes</div>
              </div>
              <div className="absolute bottom-14 right-6 hidden font-mono text-[8px] uppercase tracking-[.2em] text-white/18 lg:block">02 / atmosphere</div>
            </div>
          </motion.div>
        </section>

        <section className="relative h-[126svh] px-5 sm:px-8 lg:px-12">
          <motion.div style={{ opacity: question }} className="sticky top-0 flex h-screen items-center">
            <div className="mx-auto w-full max-w-[1700px]">
              <div className="grid items-center gap-10 lg:grid-cols-[.78fr_1.22fr]">
                <div className="max-w-xl">
                  <div className="mb-5 font-mono text-[9px] uppercase tracking-[.34em] text-[#8ce0cf]">02 / A human asks</div>
                  <h2 className="font-display text-[clamp(3.2rem,6.7vw,7rem)] font-bold leading-[.8] tracking-[-.065em]">Start with<br /><span className="text-white/35">a question.</span></h2>
                  <p className="mt-7 max-w-md text-sm leading-6 text-white/42 sm:text-base">No dashboard to decode first. A person asks what they need to know, in plain language.</p>
                </div>
                <div className="relative mx-auto w-full max-w-3xl">
                  <div className="absolute -inset-10 rounded-full bg-[#7fd4c1]/[.06] blur-3xl" />
                  <div className="relative border border-white/15 bg-[#07151b]/50 p-7 backdrop-blur-xl sm:p-10">
                    <div className="flex items-center justify-between border-b border-white/10 pb-5 font-mono text-[8px] uppercase tracking-[.2em] text-white/28"><span className="flex items-center gap-2"><MessageCircle className="h-3.5 w-3.5 text-[#8ce0cf]" /> Phone / query</span><span className="text-[#8ce0cf]">Ready</span></div>
                    <div className="py-12 sm:py-16"><div className="font-display text-[clamp(2.1rem,4.5vw,4.8rem)] font-semibold leading-[.9] tracking-[-.05em]">“What is the marine condition near Digha?”</div></div>
                    <div className="flex items-center justify-between border-t border-white/10 pt-5 font-mono text-[8px] uppercase tracking-[.2em] text-white/25"><span>One question</span><span className="flex items-center gap-2 text-[#8ce0cf]">Send <ArrowRight className="h-3 w-3" /></span></div>
                  </div>
                </div>
              </div>
            </div>
          </motion.div>
        </section>

        <section id="workflow" className="relative h-[160svh] px-5 sm:px-8 lg:px-12">
          <motion.div style={{ opacity: journey }} className="sticky top-0 flex h-screen items-center">
            <div className="mx-auto w-full max-w-[1700px]">
              <div className="mb-14 max-w-5xl">
                <div className="mb-5 font-mono text-[9px] uppercase tracking-[.34em] text-[#8ce0cf]">03 / The journey</div>
                <h2 className="font-display text-[clamp(3.4rem,7.6vw,8rem)] font-bold leading-[.8] tracking-[-.07em]">One question.<br /><span className="text-white/35">One clear journey.</span></h2>
              </div>

              <div className="relative max-w-6xl">
                <div className="absolute left-0 right-0 top-[34px] hidden h-px bg-gradient-to-r from-[#7fd4c1]/10 via-[#7fd4c1]/45 to-[#f4c55d]/40 md:block" />
                <div className="grid gap-7 md:grid-cols-5 md:gap-0">
                  {STAGES.map(([number, title, text], index) => <JourneyStage key={number} number={number} title={title} text={text} index={index} />)}
                </div>
              </div>

              <div className="mt-14 flex max-w-2xl items-center gap-4 font-mono text-[8px] uppercase tracking-[.2em] text-white/24"><span className="h-1.5 w-1.5 rounded-full bg-[#8ce0cf] shadow-[0_0_15px_#8ce0cf]" /> The complexity stays behind the experience.</div>
            </div>
          </motion.div>
        </section>

        <section className="relative h-[124svh] px-5 sm:px-8 lg:px-12">
          <motion.div style={{ opacity: finale }} className="sticky top-0 flex h-screen items-center">
            <div className="mx-auto w-full max-w-[1700px]">
              <div className="relative overflow-hidden border border-white/10 bg-[#06131a]/55 p-8 backdrop-blur-xl sm:p-14 lg:p-20">
                <div className="absolute -right-32 -top-32 h-96 w-96 rounded-full bg-[#7fd4c1]/10 blur-3xl" />
                <div className="absolute bottom-0 right-0 h-px w-2/3 bg-gradient-to-l from-[#f4c55d]/55 to-transparent" />
                <div className="relative max-w-6xl">
                  <div className="mb-6 flex items-center gap-3 font-mono text-[9px] uppercase tracking-[.34em] text-[#8ce0cf]"><Satellite className="h-4 w-4" /> 04 / What comes back</div>
                  <h2 className="font-display text-[clamp(3.5rem,8.4vw,9rem)] font-bold leading-[.76] tracking-[-.075em]">Not more data.<br /><span className="text-[#8ce0cf]">A better next move.</span></h2>
                  <p className="mt-9 max-w-xl text-base leading-7 text-white/44 sm:text-lg">ORCA-X connects the changing picture to a response that is easier to understand — and easier to act on.</p>
                  <button onClick={onEnterConsole} className="group mt-10 inline-flex items-center gap-4 border border-[#8ce0cf]/45 bg-[#8ce0cf]/[.08] px-6 py-4 font-mono text-[9px] uppercase tracking-[.24em] text-[#bdf7eb] transition hover:border-[#8ce0cf] hover:bg-[#8ce0cf]/[.14]">Enter Live Console <ArrowRight className="h-4 w-4 transition group-hover:translate-x-1.5" /></button>
                </div>
                <div className="absolute bottom-7 right-8 hidden font-mono text-[8px] uppercase tracking-[.2em] text-white/18 lg:block">Live view → live decision</div>
              </div>
            </div>
          </motion.div>
        </section>
      </main>

      <div className="fixed bottom-5 left-1/2 z-50 flex -translate-x-1/2 items-center gap-3 rounded-full border border-white/10 bg-[#06131a]/60 px-4 py-2 font-mono text-[8px] uppercase tracking-[.18em] text-white/28 backdrop-blur-xl">
        <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-[#8ce0cf]" /> Scroll to explore <span className="text-white/15">/</span> ORCA-X
      </div>
    </div>
  );
};

const JourneyStage = ({ number, title, text, index }: { number: string; title: string; text: string; index: number }) => (
  <motion.div
    initial={{ opacity: 0, y: 22 }}
    whileInView={{ opacity: 1, y: 0 }}
    viewport={{ once: true, amount: .4 }}
    transition={{ duration: .65, delay: index * .09 }}
    className="relative pr-7 md:min-h-48 md:border-l md:border-white/10 md:pl-6"
  >
    <div className="relative z-10 mb-7 grid h-[18px] w-[18px] place-items-center rounded-full border border-[#7fd4c1]/50 bg-[#06131a] shadow-[0_0_22px_rgba(127,212,193,.16)]">
      <span className="h-1.5 w-1.5 rounded-full bg-[#7fd4c1]" />
    </div>
    <div className="font-mono text-[8px] tracking-[.2em] text-white/25">{number}</div>
    <h3 className="mt-4 font-display text-[clamp(1.7rem,2.8vw,2.7rem)] font-semibold tracking-[-.045em]">{title}</h3>
    <p className="mt-3 max-w-[190px] text-xs leading-5 text-white/35">{text}</p>
  </motion.div>
);

export default SynopsisPagePremium;
