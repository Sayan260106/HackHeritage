import React, { useLayoutEffect, useRef, useState } from "react";
import { motion, useMotionValueEvent, useScroll, useSpring, useTransform } from "motion/react";
import { ArrowDown, ArrowRight, Compass, Globe2, Map, Radio, Waves } from "lucide-react";
import { OrcaCinematicWorld } from "../components/landing/OrcaCinematicWorld";
import { OrcaGlassCard } from "../components/kokonutui/OrcaGlassCard";
import { OrcaParticleButton } from "../components/kokonutui/OrcaParticleButton";
import { createTimeline, stagger, withMotion } from "../lib/anime";

interface SynopsisPageProps { onEnterConsole: () => void; }

const FLOW = [
  { key: "ASK", title: "Ask", body: "Start with a question about the ocean.", icon: "01" },
  { key: "OBSERVE", title: "Observe", body: "ORCA-X looks across the ocean and surrounding conditions.", icon: "02" },
  { key: "UNDERSTAND", title: "Understand", body: "Different signals come together into one clear picture.", icon: "03" },
  { key: "PREDICT", title: "Predict", body: "See what may happen next, before the voyage gets there.", icon: "04" },
  { key: "ACT", title: "Act", body: "Turn the insight into a practical decision in the Live Console.", icon: "05" },
];
const MARQUEE = ["SATELLITE", "WEATHER", "OCEAN", "RISK", "FORECAST", "DECISION SUPPORT"];

export const SynopsisPage: React.FC<SynopsisPageProps> = ({ onEnterConsole }) => {
  const heroRef = useRef<HTMLDivElement>(null);
  const { scrollYProgress } = useScroll();
  const smooth = useSpring(scrollYProgress, { stiffness: 80, damping: 24, restDelta: 0.001 });
  const [activeStep, setActiveStep] = useState(0);

  useMotionValueEvent(smooth, "change", (v) => {
    const normalized = Math.min(1, Math.max(0, (v - 0.34) / 0.44));
    setActiveStep(Math.min(FLOW.length - 1, Math.floor(normalized * FLOW.length)));
  });

  useLayoutEffect(() => {
    const root = heroRef.current;
    if (!root) return;
    const lines = root.querySelectorAll<HTMLElement>("[data-hero-line]");
    const tails = root.querySelectorAll<HTMLElement>("[data-hero-tail]");
    return withMotion(() => {
      const tl = createTimeline({ defaults: { ease: "out(3)" } });
      tl.add(lines, { y: ["110%", "0%"], opacity: [0, 1], duration: 900, delay: stagger(90) })
        .add(tails, { y: [14, 0], opacity: [0, 1], duration: 650, delay: stagger(80) }, "-=450");
      return tl;
    }, () => [...lines, ...tails].forEach((node) => { node.style.opacity = "1"; node.style.transform = "none"; }));
  }, []);

  const heroOpacity = useTransform(smooth, [0, 0.2, 0.33], [1, 0.8, 0]);
  const heroY = useTransform(smooth, [0, 0.34], [0, -90]);
  const worldLabelOpacity = useTransform(smooth, [0.12, 0.25, 0.42], [0, 1, 0]);
  const queryOpacity = useTransform(smooth, [0.25, 0.34, 0.43, 0.5], [0, 1, 1, 0]);
  const workflowOpacity = useTransform(smooth, [0.31, 0.38, 0.78, 0.84], [0, 1, 1, 0]);
  const resultOpacity = useTransform(smooth, [0.66, 0.75, 0.82], [0, 1, 0]);
  const packetX = useTransform(smooth, [0.36, 0.44, 0.53, 0.62, 0.72, 0.8], ["8%", "27%", "48%", "67%", "82%", "92%"]);
  const packetY = useTransform(smooth, [0.36, 0.44, 0.53, 0.62, 0.72, 0.8], ["50%", "50%", "35%", "65%", "35%", "50%"]);

  return (
    <div className="relative min-h-screen overflow-x-clip bg-[#02070b] text-[#e8ede9]">
      <OrcaCinematicWorld progress={smooth} />

      <header className="fixed left-0 right-0 top-0 z-50 border-b border-white/8 bg-[#02070b]/35 backdrop-blur-xl">
        <div className="mx-auto flex max-w-7xl items-center justify-between px-5 py-4 sm:px-8">
          <button onClick={() => window.scrollTo({ top: 0, behavior: "smooth" })} className="flex items-center gap-3 text-left">
            <span className="flex h-8 w-8 items-center justify-center border border-[#7fd4c1]/35 bg-[#7fd4c1]/10"><Waves className="h-4 w-4 text-[#7fd4c1]" /></span>
            <span className="font-display text-sm font-bold tracking-[0.16em]">ORCA-X</span>
          </button>
          <div className="hidden items-center gap-7 font-mono text-[9px] uppercase tracking-[0.22em] text-white/45 md:flex">
            <a href="#story" className="transition-colors hover:text-[#7fd4c1]">Story</a>
            <a href="#workflow" className="transition-colors hover:text-[#7fd4c1]">Workflow</a>
            <button onClick={onEnterConsole} className="text-[#7fd4c1] transition-colors hover:text-white">Live Console →</button>
          </div>
        </div>
      </header>

      <main className="relative z-10">
        <section ref={heroRef} className="relative flex min-h-[120svh] items-end px-5 pb-24 pt-32 sm:px-8 sm:pb-28">
          <motion.div style={{ opacity: heroOpacity, y: heroY }} className="mx-auto w-full max-w-7xl">
            <div className="max-w-4xl">
              <div data-hero-tail className="mb-6 font-mono text-[10px] uppercase tracking-[0.35em] text-[#7fd4c1] opacity-0">Ocean Reasoning &amp; Collaborative AI</div>
              <h1 className="font-display text-[clamp(3.7rem,11vw,9.5rem)] font-extrabold leading-[0.82] tracking-[-0.06em]">
                <span className="block overflow-hidden"><span data-hero-line className="block opacity-0">Understand</span></span>
                <span className="block overflow-hidden"><span data-hero-line className="block opacity-0 text-[#7fd4c1]">the ocean.</span></span>
                <span className="block overflow-hidden"><span data-hero-line className="block opacity-0">Before it changes.</span></span>
              </h1>
              <p data-hero-tail className="mt-8 max-w-xl text-base leading-7 text-white/60 opacity-0 sm:text-lg">ORCA-X turns a changing ocean into a clear, practical picture for people who need to make decisions at sea.</p>
              <div data-hero-tail className="mt-9 flex items-center gap-4 opacity-0">
                <a href="#story" className="inline-flex items-center gap-3 border border-white/15 bg-white/[0.05] px-5 py-3 font-mono text-[10px] uppercase tracking-[0.2em] backdrop-blur-xl transition hover:border-[#7fd4c1]/45 hover:bg-[#7fd4c1]/10">Explore the story <ArrowDown className="h-3.5 w-3.5" /></a>
                <span className="hidden font-mono text-[9px] uppercase tracking-[0.18em] text-white/35 sm:inline">Scroll to begin the voyage</span>
              </div>
            </div>
          </motion.div>
        </section>

        <section id="story" className="relative min-h-[115svh] px-5 py-28 sm:px-8 sm:py-36">
          <motion.div style={{ opacity: worldLabelOpacity }} className="sticky top-28 mx-auto max-w-7xl">
            <div className="max-w-2xl">
              <span className="font-mono text-[10px] uppercase tracking-[0.3em] text-[#7fd4c1]">From the water to the bigger picture</span>
              <h2 className="mt-5 font-display text-5xl font-bold leading-[0.95] tracking-[-0.04em] sm:text-7xl">The voyage is only the beginning.</h2>
              <p className="mt-7 max-w-xl text-base leading-7 text-white/55 sm:text-lg">A fishing vessel moves through a living ocean. Conditions change around it every hour. ORCA-X brings those changing signals together so the people on the voyage can see what matters.</p>
            </div>
            <div className="mt-16 flex items-center gap-3 font-mono text-[9px] uppercase tracking-[0.24em] text-white/35"><Compass className="h-4 w-4 text-[#7fd4c1]" /> One ocean. Many signals. One clear view.</div>
          </motion.div>
        </section>

        <section className="relative min-h-[80svh] px-5 py-24 sm:px-8">
          <motion.div style={{ opacity: queryOpacity }} className="mx-auto flex min-h-[55svh] max-w-7xl items-center justify-center">
            <div className="relative w-full max-w-3xl">
              <div className="absolute -inset-16 rounded-full bg-[#7fd4c1]/8 blur-3xl" />
              <OrcaGlassCard className="relative overflow-hidden p-5 sm:p-7">
                <div className="mb-5 flex items-center justify-between border-b border-white/8 pb-4"><span className="font-mono text-[9px] uppercase tracking-[0.24em] text-white/40">A question from the voyage</span><span className="flex items-center gap-2 font-mono text-[9px] uppercase tracking-[0.18em] text-[#7fd4c1]"><span className="h-1.5 w-1.5 rounded-full bg-[#7fd4c1] shadow-[0_0_10px_#7fd4c1]" /> Connected</span></div>
                <div className="flex items-end gap-4"><div className="flex h-12 w-8 shrink-0 items-center justify-center rounded-[8px] border border-white/15 bg-[#08141c] text-[#7fd4c1]"><Radio className="h-4 w-4" /></div><div><div className="font-mono text-[9px] uppercase tracking-[0.2em] text-white/35">Query</div><div className="mt-1 font-display text-2xl font-semibold leading-tight sm:text-3xl">“What is the marine condition near Digha?”</div></div></div>
                <div className="mt-7 flex items-center justify-between border-t border-white/8 pt-4 text-[11px] text-white/40"><span>Send to ORCA-X</span><span className="flex items-center gap-2 text-[#7fd4c1]">Go <ArrowRight className="h-3.5 w-3.5" /></span></div>
              </OrcaGlassCard>
            </div>
          </motion.div>
        </section>

        <section id="workflow" className="relative min-h-[250svh] px-5 sm:px-8">
          <div className="sticky top-0 flex min-h-screen items-center overflow-hidden py-20">
            <motion.div style={{ opacity: workflowOpacity }} className="mx-auto w-full max-w-7xl">
              <div className="grid gap-12 lg:grid-cols-[0.72fr_1.28fr] lg:items-center">
                <div>
                  <span className="font-mono text-[10px] uppercase tracking-[0.3em] text-[#7fd4c1]">The ORCA-X journey</span>
                  <h2 className="mt-5 font-display text-5xl font-bold leading-[0.92] tracking-[-0.04em] sm:text-7xl">Ask.<br />Observe.<br />Understand.<br />Predict.<br /><span className="text-[#7fd4c1]">Act.</span></h2>
                  <p className="mt-7 max-w-md text-sm leading-6 text-white/45">No complicated screens. No maze of technical details. Just a clear journey from a human question to a useful answer.</p>
                  <div className="mt-8 flex gap-2">{FLOW.map((step, i) => <span key={step.key} className={`h-1.5 transition-all duration-500 ${i === activeStep ? "w-10 bg-[#7fd4c1]" : "w-2 bg-white/15"}`} />)}</div>
                </div>
                <div className="relative min-h-[440px] sm:min-h-[520px]">
                  <svg className="absolute inset-0 h-full w-full overflow-visible" viewBox="0 0 800 520" preserveAspectRatio="none"><path d="M40 260 C180 80 280 430 400 260 S620 80 760 260" fill="none" stroke="rgba(255,255,255,.09)" strokeWidth="2" /><path d="M40 260 C180 80 280 430 400 260 S620 80 760 260" fill="none" stroke="rgba(127,212,193,.65)" strokeWidth="2" strokeDasharray="5 15" /></svg>
                  <motion.div className="absolute h-3 w-3 -translate-x-1/2 -translate-y-1/2 rounded-full bg-[#7fd4c1] shadow-[0_0_26px_8px_rgba(127,212,193,.32)]" style={{ left: packetX, top: packetY }} />
                  <div className="absolute left-[2%] top-1/2 -translate-y-1/2"><FlowNode step={FLOW[0]} active={activeStep >= 0} /></div>
                  <div className="absolute left-[22%] top-[13%]"><FlowNode step={FLOW[1]} active={activeStep >= 1} /></div>
                  <div className="absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2"><FlowNode step={FLOW[2]} active={activeStep >= 2} /></div>
                  <div className="absolute right-[21%] top-[13%]"><FlowNode step={FLOW[3]} active={activeStep >= 3} /></div>
                  <div className="absolute right-[0%] top-1/2 -translate-y-1/2"><FlowNode step={FLOW[4]} active={activeStep >= 4} /></div>
                </div>
              </div>
            </motion.div>
          </div>
        </section>

        <section className="relative min-h-[110svh] px-5 py-28 sm:px-8 sm:py-36">
          <motion.div style={{ opacity: resultOpacity }} className="mx-auto max-w-7xl">
            <div className="grid gap-6 lg:grid-cols-3"><div className="lg:col-span-2"><span className="font-mono text-[10px] uppercase tracking-[0.3em] text-[#7fd4c1]">From information to action</span><h2 className="mt-5 max-w-3xl font-display text-5xl font-bold leading-[0.92] tracking-[-0.04em] sm:text-7xl">A clearer answer, when the ocean matters most.</h2></div><div className="flex items-end text-sm leading-6 text-white/45">ORCA-X is designed to help people understand changing marine conditions, identify risk, and make better-informed decisions before and during a voyage.</div></div>
            <div className="mt-16 grid gap-4 md:grid-cols-3">
              <OrcaGlassCard className="p-6 sm:p-7"><Globe2 className="h-5 w-5 text-[#7fd4c1]" /><h3 className="mt-8 font-display text-2xl font-semibold">See the ocean</h3><p className="mt-3 text-sm leading-6 text-white/45">Bring the changing environment into one view instead of checking many places separately.</p></OrcaGlassCard>
              <OrcaGlassCard className="p-6 sm:p-7"><Map className="h-5 w-5 text-[#f2b33d]" /><h3 className="mt-8 font-display text-2xl font-semibold">Understand the risk</h3><p className="mt-3 text-sm leading-6 text-white/45">Turn complicated conditions into a simple picture of what deserves attention.</p></OrcaGlassCard>
              <OrcaGlassCard className="p-6 sm:p-7"><Compass className="h-5 w-5 text-[#7fd4c1]" /><h3 className="mt-8 font-display text-2xl font-semibold">Make the next move</h3><p className="mt-3 text-sm leading-6 text-white/45">Give crews, operators and decision-makers a practical starting point for action.</p></OrcaGlassCard>
            </div>
          </motion.div>
        </section>

        <section className="relative min-h-[115svh] px-5 py-28 sm:px-8 sm:py-40">
          <div className="mx-auto flex max-w-7xl flex-col items-center text-center">
            <div className="mb-10 flex flex-wrap justify-center gap-x-6 gap-y-3 font-mono text-[9px] uppercase tracking-[0.22em] text-white/25">{MARQUEE.map((item) => <span key={item}>{item}</span>)}</div>
            <span className="font-mono text-[10px] uppercase tracking-[0.3em] text-[#7fd4c1]">The journey ends here</span>
            <h2 className="mt-6 max-w-5xl font-display text-[clamp(3.6rem,9vw,8rem)] font-extrabold leading-[0.86] tracking-[-0.06em]">The ocean is vast.<br /><span className="text-[#7fd4c1]">Your understanding shouldn't be.</span></h2>
            <p className="mt-8 max-w-2xl text-base leading-7 text-white/50 sm:text-lg">Take the story into the real system. Explore the ORCA-X Live Console and work with the ocean intelligence behind this experience.</p>
            <div className="mt-10"><OrcaParticleButton onClick={onEnterConsole}>Enter Live Console <ArrowRight className="ml-2 inline h-3.5 w-3.5" /></OrcaParticleButton></div>
            <div className="mt-14 font-mono text-[9px] uppercase tracking-[0.25em] text-white/20">ORCA-X · Ocean Reasoning &amp; Collaborative AI</div>
          </div>
        </section>
      </main>
    </div>
  );
};

const FlowNode: React.FC<{ step: typeof FLOW[number]; active: boolean }> = ({ step, active }) => (
  <motion.div animate={{ scale: active ? 1 : 0.92, opacity: active ? 1 : 0.38 }} transition={{ duration: 0.45 }} className="w-28 sm:w-36">
    <div className={`border p-3 backdrop-blur-xl transition-colors duration-500 ${active ? "border-[#7fd4c1]/35 bg-[#071820]/85" : "border-white/8 bg-[#071018]/60"}`}>
      <div className="flex items-center justify-between"><span className="font-mono text-[8px] text-white/35">{step.icon}</span><span className={`h-1.5 w-1.5 rounded-full ${active ? "bg-[#7fd4c1] shadow-[0_0_10px_#7fd4c1]" : "bg-white/20"}`} /></div>
      <div className="mt-5 font-display text-lg font-semibold sm:text-xl">{step.title}</div>
      <div className="mt-2 text-[10px] leading-4 text-white/40">{step.body}</div>
    </div>
  </motion.div>
);

export default SynopsisPage;
