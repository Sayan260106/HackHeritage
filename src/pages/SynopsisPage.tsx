import React, { useLayoutEffect, useRef } from "react";
import { motion, useScroll, useSpring, useTransform } from "motion/react";
import { ArrowDown, ArrowRight, Compass, MessageCircle, Waves } from "lucide-react";
import { OrcaCinematicWorld } from "../components/landing/OrcaCinematicWorld";
import { OrcaGlassCard } from "../components/kokonutui/OrcaGlassCard";
import { OrcaParticleButton } from "../components/kokonutui/OrcaParticleButton";
import { createTimeline, stagger, withMotion } from "../lib/anime";

interface SynopsisPageProps { onEnterConsole: () => void; }

const FLOW = [
  { n: "01", title: "Ask", text: "A simple question starts the journey." },
  { n: "02", title: "Observe", text: "ORCA-X looks at the ocean around it." },
  { n: "03", title: "Understand", text: "Signals become one clear picture." },
  { n: "04", title: "Predict", text: "The picture points toward what comes next." },
  { n: "05", title: "Act", text: "Clarity returns as a useful next move." },
];

export const SynopsisPage: React.FC<SynopsisPageProps> = ({ onEnterConsole }) => {
  const heroRef = useRef<HTMLDivElement>(null);
  const { scrollYProgress } = useScroll();
  const progress = useSpring(scrollYProgress, { stiffness: 58, damping: 24, restDelta: 0.001 });

  useLayoutEffect(() => {
    const root = heroRef.current;
    if (!root) return;
    const items = root.querySelectorAll<HTMLElement>("[data-intro]");
    return withMotion(() => {
      const tl = createTimeline({ defaults: { ease: "out(4)" } });
      tl.add(items, { opacity: [0, 1], y: [28, 0], duration: 850, delay: stagger(100) });
      return tl;
    }, () => items.forEach((el) => { el.style.opacity = "1"; el.style.transform = "none"; }));
  }, []);

  const heroOpacity = useTransform(progress, [0, .1, .2], [1, 1, 0]);
  const heroY = useTransform(progress, [0, .22], [0, -110]);
  const voyageOpacity = useTransform(progress, [.08, .17, .34, .43], [0, 1, 1, 0]);
  const voyageY = useTransform(progress, [.08, .38], [70, -35]);
  const questionOpacity = useTransform(progress, [.34, .43, .53, .6], [0, 1, 1, 0]);
  const questionY = useTransform(progress, [.34, .58], [70, -20]);
  const workflowOpacity = useTransform(progress, [.54, .63, .83, .9], [0, 1, 1, 0]);
  const answerOpacity = useTransform(progress, [.84, .93, 1], [0, 1, 1]);
  const packetX = useTransform(progress, [.62, .67, .72, .77, .82], ["8%", "29%", "50%", "71%", "92%"]);
  const packetY = useTransform(progress, [.62, .67, .72, .77, .82], ["51%", "44%", "55%", "43%", "51%"]);

  return (
    <div className="relative min-h-[690svh] overflow-x-clip bg-[#02070b] text-[#e8ede9] selection:bg-[#7fd4c1]/30">
      <OrcaCinematicWorld progress={progress} />

      <header className="fixed inset-x-0 top-0 z-50 border-b border-white/[.07] bg-[#02070b]/30 backdrop-blur-xl">
        <div className="mx-auto flex max-w-[1500px] items-center justify-between px-5 py-4 sm:px-8">
          <button onClick={() => window.scrollTo({ top: 0, behavior: "smooth" })} className="flex items-center gap-3">
            <span className="grid h-8 w-8 place-items-center border border-[#7fd4c1]/35 bg-[#7fd4c1]/10"><Waves className="h-4 w-4 text-[#7fd4c1]" /></span>
            <span className="font-display text-sm font-bold tracking-[.2em]">ORCA-X</span>
          </button>
          <nav className="hidden items-center gap-8 font-mono text-[9px] uppercase tracking-[.22em] text-white/45 md:flex">
            <a href="#voyage" className="transition-colors hover:text-[#7fd4c1]">Voyage</a>
            <a href="#workflow" className="transition-colors hover:text-[#7fd4c1]">How it works</a>
            <button onClick={onEnterConsole} className="text-[#7fd4c1] transition-colors hover:text-white">Live Console →</button>
          </nav>
        </div>
      </header>

      <main className="relative z-10">
        <section ref={heroRef} className="relative flex min-h-[112svh] items-center px-5 pt-16 sm:px-8">
          <motion.div style={{ opacity: heroOpacity, y: heroY }} className="mx-auto w-full max-w-[1500px]">
            <div className="max-w-4xl">
              <div data-intro className="mb-5 font-mono text-[9px] uppercase tracking-[.4em] text-[#7fd4c1] opacity-0">Ocean Reasoning &amp; Collaborative AI</div>
              <h1 className="font-display text-[clamp(4rem,10.5vw,10rem)] font-extrabold leading-[.78] tracking-[-.07em]">
                <span data-intro className="block opacity-0">Read the</span>
                <span data-intro className="block text-[#7fd4c1] opacity-0">ocean.</span>
                <span data-intro className="block opacity-0 text-white/90">Before it moves.</span>
              </h1>
              <p data-intro className="mt-8 max-w-lg text-base leading-7 text-white/50 opacity-0 sm:text-lg">A living ocean changes by the hour. ORCA-X turns that change into a story you can understand and act on.</p>
              <div data-intro className="mt-8 flex items-center gap-4 opacity-0">
                <a href="#voyage" className="inline-flex items-center gap-3 border border-white/15 bg-white/[.045] px-5 py-3 font-mono text-[10px] uppercase tracking-[.2em] backdrop-blur-xl transition-colors hover:border-[#7fd4c1]/45 hover:bg-[#7fd4c1]/10">Begin the voyage <ArrowDown className="h-3.5 w-3.5" /></a>
                <span className="hidden font-mono text-[9px] uppercase tracking-[.18em] text-white/25 sm:inline">Scroll to pull back</span>
              </div>
            </div>
          </motion.div>
        </section>

        <section id="voyage" className="relative min-h-[150svh] px-5 sm:px-8">
          <motion.div style={{ opacity: voyageOpacity, y: voyageY }} className="sticky top-[18vh] mx-auto max-w-[1500px]">
            <div className="max-w-2xl">
              <span className="font-mono text-[9px] uppercase tracking-[.34em] text-[#7fd4c1]">01 / The voyage</span>
              <h2 className="mt-5 font-display text-5xl font-bold leading-[.86] tracking-[-.055em] sm:text-8xl">Out there,<br /><span className="text-white/38">everything moves.</span></h2>
              <p className="mt-7 max-w-xl text-base leading-7 text-white/48 sm:text-lg">A fishing vessel is never moving through the same ocean twice. Wind shifts. Waves build. Visibility changes.</p>
              <div className="mt-9 flex items-center gap-3 font-mono text-[9px] uppercase tracking-[.2em] text-white/30"><Compass className="h-4 w-4 text-[#7fd4c1]" /> One vessel. One changing ocean.</div>
            </div>
          </motion.div>
        </section>

        <section className="relative min-h-[120svh] px-5 sm:px-8">
          <motion.div style={{ opacity: questionOpacity, y: questionY }} className="sticky top-[18vh] mx-auto max-w-[1500px]">
            <div className="grid items-center gap-10 lg:grid-cols-[.8fr_1.2fr]">
              <div className="hidden lg:block lg:pl-[8vw]">
                <div className="font-mono text-[9px] uppercase tracking-[.34em] text-[#7fd4c1]">02 / A human asks</div>
                <h2 className="mt-5 max-w-md font-display text-6xl font-bold leading-[.88] tracking-[-.055em]">Start with<br /><span className="text-white/40">a question.</span></h2>
              </div>
              <div className="mx-auto w-full max-w-2xl">
                <div className="mb-6 flex items-center justify-between font-mono text-[9px] uppercase tracking-[.28em] text-white/30"><span className="flex items-center gap-2"><MessageCircle className="h-3.5 w-3.5 text-[#7fd4c1]" /> From the phone</span><span className="text-[#7fd4c1]">Ready</span></div>
                <OrcaGlassCard className="relative overflow-hidden p-6 sm:p-9">
                  <div className="absolute right-0 top-0 h-48 w-48 rounded-full bg-[#7fd4c1]/10 blur-3xl" />
                  <div className="relative flex items-center gap-4 border-b border-white/[.08] pb-5"><span className="grid h-9 w-7 place-items-center rounded border border-white/10 bg-[#07131a]"><MessageCircle className="h-3.5 w-3.5 text-[#7fd4c1]" /></span><div><div className="font-mono text-[8px] uppercase tracking-[.22em] text-white/25">Question</div><div className="mt-1 text-xs text-white/45">Marine conditions · Digha</div></div></div>
                  <div className="relative py-10 sm:py-14"><div className="font-display text-3xl font-semibold leading-tight tracking-[-.035em] sm:text-5xl">“What is the marine condition near Digha?”</div></div>
                  <div className="relative flex items-center justify-between border-t border-white/[.08] pt-5 font-mono text-[9px] uppercase tracking-[.2em] text-white/25"><span>Human question</span><span className="flex items-center gap-2 text-[#7fd4c1]">Transmit <ArrowRight className="h-3.5 w-3.5" /></span></div>
                </OrcaGlassCard>
              </div>
            </div>
          </motion.div>
        </section>

        <section id="workflow" className="relative min-h-[235svh] px-5 sm:px-8">
          <div className="sticky top-0 flex min-h-screen items-center">
            <motion.div style={{ opacity: workflowOpacity }} className="mx-auto w-full max-w-[1500px]">
              <div className="mb-10 max-w-4xl">
                <span className="font-mono text-[9px] uppercase tracking-[.34em] text-[#7fd4c1]">03 / The journey</span>
                <h2 className="mt-5 font-display text-5xl font-bold leading-[.84] tracking-[-.055em] sm:text-8xl">From a question<br /><span className="text-[#7fd4c1]">to a clear next move.</span></h2>
              </div>
              <div className="relative pt-3">
                <svg className="absolute left-0 top-[48%] h-20 w-full -translate-y-1/2" viewBox="0 0 1200 100" preserveAspectRatio="none" aria-hidden="true">
                  <path d="M45 50 C260 50 300 50 430 50 S660 50 790 50 S1010 50 1155 50" fill="none" stroke="rgba(255,255,255,.08)" strokeWidth="2" />
                  <path d="M45 50 C260 50 300 50 430 50 S660 50 790 50 S1010 50 1155 50" fill="none" stroke="rgba(127,212,193,.62)" strokeWidth="2" strokeDasharray="5 14" />
                </svg>
                <motion.div style={{ left: packetX, top: packetY }} className="absolute z-20 h-3.5 w-3.5 -translate-x-1/2 -translate-y-1/2 rounded-full bg-[#7fd4c1] shadow-[0_0_32px_9px_rgba(127,212,193,.42)]" />
                <div className="grid grid-cols-1 gap-3 sm:grid-cols-5">{FLOW.map((step, index) => <FlowCard key={step.n} step={step} index={index} />)}</div>
              </div>
              <div className="mt-8 flex flex-wrap gap-x-8 gap-y-2 font-mono text-[8px] uppercase tracking-[.22em] text-white/22"><span>Question</span><span>Signals</span><span>Context</span><span>Forecast</span><span>Decision</span></div>
            </motion.div>
          </div>
        </section>

        <section className="relative min-h-[135svh] px-5 py-32 sm:px-8 sm:py-44">
          <motion.div style={{ opacity: answerOpacity }} className="mx-auto max-w-[1500px]">
            <div className="max-w-4xl"><span className="font-mono text-[9px] uppercase tracking-[.34em] text-[#7fd4c1]">04 / What comes back</span><h2 className="mt-5 font-display text-5xl font-bold leading-[.84] tracking-[-.055em] sm:text-8xl">Not more data.<br /><span className="text-[#7fd4c1]">A better next move.</span></h2><p className="mt-7 max-w-xl text-base leading-7 text-white/45 sm:text-lg">ORCA-X makes changing marine conditions easier to see, understand, and respond to.</p></div>
            <div className="mt-14 grid gap-3 md:grid-cols-3"><MiniCard number="01" title="See" text="A clear picture of what is happening around the place that matters." /><MiniCard number="02" title="Understand" text="A simple story connecting the changing signals." /><MiniCard number="03" title="Move" text="A useful starting point for the next decision." /></div>
          </motion.div>
        </section>

        <section className="relative flex min-h-[120svh] items-center px-5 py-28 sm:px-8">
          <div className="mx-auto w-full max-w-[1500px]">
            <div className="relative overflow-hidden border border-white/10 bg-white/[.025] p-8 sm:p-14">
              <div className="absolute -right-32 -top-32 h-96 w-96 rounded-full bg-[#7fd4c1]/10 blur-3xl" />
              <div className="relative max-w-4xl"><span className="font-mono text-[9px] uppercase tracking-[.34em] text-[#7fd4c1]">05 / The Live Console</span><h2 className="mt-5 font-display text-5xl font-bold leading-[.84] tracking-[-.055em] sm:text-8xl">The ocean is moving.<br /><span className="text-white/38">Now ask it a question.</span></h2><p className="mt-7 max-w-xl text-base leading-7 text-white/45">Take the story into the ORCA-X Live Console and explore the live view yourself.</p><div className="mt-8"><OrcaParticleButton onClick={onEnterConsole}>Enter Live Console <ArrowRight className="ml-2 inline h-3.5 w-3.5" /></OrcaParticleButton></div></div>
            </div>
            <div className="mt-8 flex items-center justify-between font-mono text-[8px] uppercase tracking-[.25em] text-white/22"><span>ORCA-X / Ocean Reasoning &amp; Collaborative AI</span><span>Built for the people at sea</span></div>
          </div>
        </section>
      </main>
    </div>
  );
};

function FlowCard({ step, index }: { step: (typeof FLOW)[number]; index: number }) {
  return (
    <motion.div initial={{ opacity: 0, y: 18 }} whileInView={{ opacity: 1, y: 0 }} viewport={{ once: true, amount: .25 }} transition={{ delay: index * .07, duration: .5 }} className={`relative ${index === 2 ? "sm:-translate-y-6" : index === 1 || index === 3 ? "sm:translate-y-6" : ""}`}>
      <OrcaGlassCard className="h-full min-h-[190px] p-5 sm:min-h-[220px] sm:p-6"><div className="font-mono text-[9px] text-[#7fd4c1]">{step.n}</div><h3 className="mt-10 font-display text-2xl font-semibold tracking-[-.02em]">{step.title}</h3><p className="mt-3 max-w-[18rem] text-sm leading-6 text-white/42">{step.text}</p></OrcaGlassCard>
    </motion.div>
  );
}

function MiniCard({ number, title, text }: { number: string; title: string; text: string }) {
  return <OrcaGlassCard className="p-6 sm:p-7"><div className="flex items-center justify-between"><span className="font-mono text-[9px] text-[#7fd4c1]">{number}</span><span className="h-1.5 w-1.5 rounded-full bg-[#7fd4c1]/70" /></div><h3 className="mt-12 font-display text-3xl font-semibold tracking-[-.03em]">{title}</h3><p className="mt-3 max-w-sm text-sm leading-6 text-white/42">{text}</p></OrcaGlassCard>;
}
