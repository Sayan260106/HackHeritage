import React, { useLayoutEffect, useRef } from "react";
import { motion, useScroll, useSpring, useTransform } from "motion/react";
import { ArrowDown, ArrowRight, Compass, Radio, Waves } from "lucide-react";
import { OrcaCinematicWorld } from "../components/landing/OrcaCinematicWorld";
import { OrcaGlassCard } from "../components/kokonutui/OrcaGlassCard";
import { OrcaParticleButton } from "../components/kokonutui/OrcaParticleButton";
import { createTimeline, stagger, withMotion } from "../lib/anime";

interface SynopsisPageProps { onEnterConsole: () => void; }

const FLOW = [
  { n: "01", title: "Ask", text: "A person asks a simple question about the sea." },
  { n: "02", title: "Observe", text: "ORCA-X gathers the signals around that place and time." },
  { n: "03", title: "Understand", text: "Those signals become one clear picture." },
  { n: "04", title: "Predict", text: "The picture points toward what could happen next." },
  { n: "05", title: "Act", text: "The answer comes back ready to support a decision." },
];

export const SynopsisPage: React.FC<SynopsisPageProps> = ({ onEnterConsole }) => {
  const heroRef = useRef<HTMLDivElement>(null);
  const { scrollYProgress } = useScroll();
  const progress = useSpring(scrollYProgress, { stiffness: 70, damping: 24, restDelta: 0.001 });

  useLayoutEffect(() => {
    const root = heroRef.current;
    if (!root) return;
    const items = root.querySelectorAll<HTMLElement>("[data-intro]");
    return withMotion(() => {
      const tl = createTimeline({ defaults: { ease: "out(4)" } });
      tl.add(items, { opacity: [0, 1], y: [34, 0], duration: 900, delay: stagger(120) });
      return tl;
    }, () => items.forEach((el) => { el.style.opacity = "1"; el.style.transform = "none"; }));
  }, []);

  const heroOpacity = useTransform(progress, [0, .12, .22], [1, .9, 0]);
  const heroY = useTransform(progress, [0, .22], [0, -90]);
  const storyOpacity = useTransform(progress, [.09, .2, .34, .42], [0, 1, 1, 0]);
  const storyY = useTransform(progress, [.09, .38], [70, -30]);
  const questionOpacity = useTransform(progress, [.3, .4, .51, .57], [0, 1, 1, 0]);
  const questionScale = useTransform(progress, [.3, .42, .55], [.82, 1, 1.04]);
  const workflowOpacity = useTransform(progress, [.5, .58, .88, .94], [0, 1, 1, 0]);
  const answerOpacity = useTransform(progress, [.82, .91, 1], [0, 1, 1]);
  const packetX = useTransform(progress, [.56, .64, .72, .8, .9], ["8%", "29%", "50%", "71%", "92%"]);

  return (
    <div className="relative min-h-[720svh] overflow-x-clip bg-[#02070b] text-[#e8ede9] selection:bg-[#7fd4c1]/30">
      <OrcaCinematicWorld progress={progress} />

      <header className="fixed inset-x-0 top-0 z-50 border-b border-white/[.07] bg-[#02070b]/30 backdrop-blur-xl">
        <div className="mx-auto flex max-w-[1500px] items-center justify-between px-5 py-4 sm:px-8">
          <button onClick={() => window.scrollTo({ top: 0, behavior: "smooth" })} className="flex items-center gap-3"><span className="grid h-8 w-8 place-items-center border border-[#7fd4c1]/35 bg-[#7fd4c1]/10"><Waves className="h-4 w-4 text-[#7fd4c1]" /></span><span className="font-display text-sm font-bold tracking-[.2em]">ORCA-X</span></button>
          <nav className="hidden items-center gap-8 font-mono text-[9px] uppercase tracking-[.22em] text-white/45 md:flex"><a href="#voyage" className="hover:text-[#7fd4c1]">Voyage</a><a href="#workflow" className="hover:text-[#7fd4c1]">How it works</a><button onClick={onEnterConsole} className="text-[#7fd4c1] hover:text-white">Live Console →</button></nav>
        </div>
      </header>

      <main className="relative z-10">
        <section ref={heroRef} className="relative flex min-h-[125svh] items-end px-5 pb-20 sm:px-8 sm:pb-28">
          <motion.div style={{ opacity: heroOpacity, y: heroY }} className="mx-auto w-full max-w-[1500px]"><div className="max-w-5xl">
            <div data-intro className="mb-6 font-mono text-[9px] uppercase tracking-[.38em] text-[#7fd4c1] opacity-0">Ocean Reasoning &amp; Collaborative AI</div>
            <h1 className="font-display text-[clamp(3.8rem,11vw,10.5rem)] font-extrabold leading-[.8] tracking-[-.065em]"><span data-intro className="block opacity-0">Read the</span><span data-intro className="block text-[#7fd4c1] opacity-0">ocean.</span><span data-intro className="block opacity-0">Before it moves.</span></h1>
            <p data-intro className="mt-9 max-w-xl text-base leading-7 text-white/55 opacity-0 sm:text-lg">A living ocean changes by the hour. ORCA-X turns that change into a clear story people can act on.</p>
            <div data-intro className="mt-9 flex items-center gap-4 opacity-0"><a href="#voyage" className="inline-flex items-center gap-3 border border-white/15 bg-white/[.045] px-5 py-3 font-mono text-[10px] uppercase tracking-[.2em] backdrop-blur-xl hover:border-[#7fd4c1]/45 hover:bg-[#7fd4c1]/10">Begin the voyage <ArrowDown className="h-3.5 w-3.5" /></a><span className="hidden font-mono text-[9px] uppercase tracking-[.18em] text-white/30 sm:inline">Scroll to pull back</span></div>
          </div></motion.div>
        </section>

        <section id="voyage" className="relative min-h-[145svh] px-5 sm:px-8">
          <motion.div style={{ opacity: storyOpacity, y: storyY }} className="sticky top-[18vh] mx-auto max-w-[1500px]"><div className="max-w-2xl"><span className="font-mono text-[9px] uppercase tracking-[.32em] text-[#7fd4c1]">01 / The voyage</span><h2 className="mt-5 font-display text-5xl font-bold leading-[.9] tracking-[-.05em] sm:text-8xl">Out there,<br /><span className="text-white/45">everything moves.</span></h2><p className="mt-8 max-w-xl text-base leading-7 text-white/52 sm:text-lg">A fishing vessel is never moving through the same ocean twice. Wind shifts. Waves build. Visibility changes. The conditions around a route keep writing a new story.</p><div className="mt-10 flex items-center gap-3 font-mono text-[9px] uppercase tracking-[.2em] text-white/35"><Compass className="h-4 w-4 text-[#7fd4c1]" /> One vessel. One changing ocean.</div></div></motion.div>
        </section>

        <section className="relative min-h-[105svh] px-5 sm:px-8"><motion.div style={{ opacity: questionOpacity, scale: questionScale }} className="sticky top-[23vh] mx-auto max-w-[1500px]"><div className="mx-auto max-w-3xl"><div className="mb-7 text-center font-mono text-[9px] uppercase tracking-[.3em] text-white/35">02 / A human asks</div><OrcaGlassCard className="overflow-hidden p-6 sm:p-9"><div className="flex items-center justify-between border-b border-white/[.08] pb-5"><span className="font-mono text-[9px] uppercase tracking-[.24em] text-white/35">From the phone</span><span className="flex items-center gap-2 font-mono text-[9px] uppercase tracking-[.18em] text-[#7fd4c1]"><span className="h-1.5 w-1.5 rounded-full bg-[#7fd4c1] shadow-[0_0_12px_#7fd4c1]" /> Ready</span></div><div className="py-10 sm:py-14"><div className="mb-4 flex items-center gap-3 font-mono text-[9px] uppercase tracking-[.2em] text-white/30"><span className="grid h-9 w-7 place-items-center rounded border border-white/10 bg-[#07131a]"><Radio className="h-3.5 w-3.5 text-[#7fd4c1]" /></span>Question</div><div className="font-display text-3xl font-semibold leading-tight tracking-[-.025em] sm:text-5xl">“What is the marine condition near Digha?”</div></div><div className="flex items-center justify-between border-t border-white/[.08] pt-5 font-mono text-[9px] uppercase tracking-[.2em] text-white/30"><span>Send to ORCA-X</span><span className="flex items-center gap-2 text-[#7fd4c1]">Transmit <ArrowRight className="h-3.5 w-3.5" /></span></div></OrcaGlassCard></div></motion.div></section>

        <section id="workflow" className="relative min-h-[250svh] px-5 sm:px-8"><div className="sticky top-0 flex min-h-screen items-center"><motion.div style={{ opacity: workflowOpacity }} className="mx-auto w-full max-w-[1500px]"><div className="mb-12 max-w-4xl"><span className="font-mono text-[9px] uppercase tracking-[.32em] text-[#7fd4c1]">03 / The journey</span><h2 className="mt-5 font-display text-5xl font-bold leading-[.88] tracking-[-.05em] sm:text-8xl">A question goes in.<br /><span className="text-[#7fd4c1]">Clarity comes back.</span></h2></div><div className="relative min-h-[390px] sm:min-h-[450px]"><svg className="absolute left-0 top-1/2 h-24 w-full -translate-y-1/2" viewBox="0 0 1200 100" preserveAspectRatio="none"><path d="M40 50 C250 50 250 50 390 50 S680 50 800 50 S1010 50 1160 50" fill="none" stroke="rgba(255,255,255,.1)" strokeWidth="2"/><path d="M40 50 C250 50 250 50 390 50 S680 50 800 50 S1010 50 1160 50" fill="none" stroke="rgba(127,212,193,.7)" strokeWidth="2" strokeDasharray="5 14"/></svg><motion.div style={{ left: packetX }} className="absolute top-1/2 z-20 h-3 w-3 -translate-x-1/2 -translate-y-1/2 rounded-full bg-[#7fd4c1] shadow-[0_0_28px_8px_rgba(127,212,193,.35)]"/><div className="grid grid-cols-1 gap-3 sm:grid-cols-5">{FLOW.map((step,index)=><FlowCard key={step.n} step={step} index={index}/>)}</div></div><div className="mt-9 flex flex-wrap gap-x-7 gap-y-2 font-mono text-[8px] uppercase tracking-[.22em] text-white/25"><span>Human question</span><span>Signals</span><span>Context</span><span>Forecast</span><span>Decision</span></div></motion.div></div></section>

        <section className="relative min-h-[135svh] px-5 py-32 sm:px-8 sm:py-44"><motion.div style={{ opacity: answerOpacity }} className="mx-auto max-w-[1500px]"><div className="max-w-4xl"><span className="font-mono text-[9px] uppercase tracking-[.32em] text-[#7fd4c1]">04 / What comes back</span><h2 className="mt-5 font-display text-5xl font-bold leading-[.88] tracking-[-.05em] sm:text-8xl">Not more data.<br /><span className="text-[#7fd4c1]">A better next move.</span></h2><p className="mt-8 max-w-xl text-base leading-7 text-white/50 sm:text-lg">ORCA-X is built to make the ocean easier to understand: see the conditions, understand the risk, and decide what to do next.</p></div><div className="mt-16 grid gap-4 md:grid-cols-3"><MiniCard number="01" title="See" text="A live picture of the marine conditions around the place that matters."/><MiniCard number="02" title="Understand" text="A simple interpretation of what those changing signals mean."/><MiniCard number="03" title="Move" text="A practical starting point for the next decision."/></div></motion.div></section>

        <section className="relative flex min-h-[120svh] items-center px-5 py-32 sm:px-8"><div className="mx-auto w-full max-w-[1500px]"><div className="relative overflow-hidden border border-white/10 bg-white/[.025] p-8 sm:p-14"><div className="absolute -right-24 -top-24 h-72 w-72 rounded-full bg-[#7fd4c1]/10 blur-3xl"/><div className="relative max-w-4xl"><span className="font-mono text-[9px] uppercase tracking-[.32em] text-[#7fd4c1]">05 / The Live Console</span><h2 className="mt-5 font-display text-5xl font-bold leading-[.88] tracking-[-.05em] sm:text-8xl">The ocean is moving.<br /><span className="text-white/45">Now ask it a question.</span></h2><p className="mt-8 max-w-xl text-base leading-7 text-white/50">Take the story into the ORCA-X Live Console and explore the live view for yourself.</p><div className="mt-9"><OrcaParticleButton onClick={onEnterConsole}>Enter Live Console <ArrowRight className="ml-2 inline h-3.5 w-3.5"/></OrcaParticleButton></div></div></div><div className="mt-8 flex items-center justify-between font-mono text-[8px] uppercase tracking-[.25em] text-white/25"><span>ORCA-X / Ocean Reasoning &amp; Collaborative AI</span><span>Built for the people at sea</span></div></div></section>
      </main>
    </div>
  );
};

function FlowCard({ step, index }: { step: (typeof FLOW)[number]; index: number }) {
  return <motion.div initial={{ opacity: 0, y: 20 }} whileInView={{ opacity: 1, y: 0 }} viewport={{ once: true, amount: .35 }} transition={{ delay: index * .08, duration: .55 }} className={`relative ${index === 2 ? "sm:-translate-y-7" : index === 1 || index === 3 ? "sm:translate-y-7" : ""}`}><OrcaGlassCard className="h-full p-5 sm:p-6"><div className="font-mono text-[9px] text-[#7fd4c1]">{step.n}</div><h3 className="mt-10 font-display text-2xl font-semibold">{step.title}</h3><p className="mt-3 text-sm leading-6 text-white/45">{step.text}</p></OrcaGlassCard></motion.div>;
}

function MiniCard({ number, title, text }: { number: string; title: string; text: string }) {
  return <OrcaGlassCard className="p-6 sm:p-7"><div className="font-mono text-[9px] text-[#7fd4c1]">{number}</div><h3 className="mt-12 font-display text-3xl font-semibold">{title}</h3><p className="mt-3 text-sm leading-6 text-white/45">{text}</p></OrcaGlassCard>;
}

export default SynopsisPage;
