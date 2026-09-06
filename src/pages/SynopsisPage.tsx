import React, { useEffect, useLayoutEffect, useRef, useState } from "react";
import {
  motion,
  useMotionValueEvent,
  useScroll,
  useSpring,
  useTransform,
} from "motion/react";
import {
  Activity,
  Anchor,
  ArrowDown,
  ArrowRight,
  BookOpen,
  Compass,
  Globe,
  Layers,
  Radio,
  Satellite,
  ShieldCheck,
  SlidersHorizontal,
  Waves,
  Volume2,
  VolumeX,
} from "lucide-react";
import { ContourField } from "../components/ui/ContourField";
import { ScrollyCanvasBackground } from "../components/ui/ScrollyCanvasBackground";
import { useLenis } from "../hooks/useLenis";
import { DepthMarker } from "../components/ui/DepthMarker";
import { Reveal } from "../components/ui/Reveal";
import { SpotlightCard } from "../components/ui/SpotlightCard";
import { GlassPanel } from "../components/ui/GlassPanel";
import { ShimmerText } from "../components/ui/ShimmerText";
import { SoundingNumber } from "../components/ui/SoundingNumber";
import { hydrophoneEngine } from "../services/hydrophoneAudio";
import { AttractButton } from "../components/ui/AttractButton";
import { Marquee } from "../components/ui/Marquee";
import { BentoGrid, BentoCell } from "../components/ui/BentoGrid";
import { TrackLine, TrackStep } from "../components/ui/TrackLine";
import { COASTAL_LOCATIONS } from "../data/coastalData";
import { IndianCoastalMap } from "../components/IndianCoastalMap";
import { createTimeline, stagger, withMotion } from "../lib/anime";
/* ---------------------------------------------------------------------------
   Content. Every threshold and authority below is drawn from the evidence
   corpus the running system actually retrieves.
   ------------------------------------------------------------------------ */

const LAUNCH_THRESHOLDS = [
  {
    value: 1.8,
    precision: 1,
    suffix: " m",
    label: "Significant wave height",
    note: "Above this, nearshore breakers capsize craft under 10 m",
    authority: "INCOIS",
  },
  {
    value: 14,
    precision: 0,
    suffix: " s",
    label: "Swell period",
    note: "Long-period swell on a calm-looking morning ends beach launching",
    authority: "INCOIS",
  },
  {
    value: 30,
    precision: 0,
    suffix: " kt",
    label: "Gust ceiling",
    note: "Squally gusts past this bar deep-sea ventures outright",
    authority: "IMD",
  },
  {
    value: 5,
    precision: 0,
    suffix: " nm",
    label: "Shelter radius",
    note: "Rough-to-very-rough seas confine small trawlers to this range",
    authority: "IMD",
  },
];

const AUTHORITIES = [
  {
    name: "INCOIS",
    doc: "Ocean State Forecast",
    detail:
      "Wave height and swell-surge thresholds for artisanal craft, refreshed on its own cycle.",
  },
  {
    name: "IMD",
    doc: "Cyclone & squall bulletins",
    detail:
      "Squally-wind staging and Douglas sea-state grading for the Bay of Bengal coastal strips.",
  },
  {
    name: "CMFRI",
    doc: "Potential fishing zones",
    detail:
      "Satellite thermal fronts and chlorophyll advisories — where the catch is, not whether it is safe.",
  },
  {
    name: "Indian Coast Guard",
    doc: "Safety-equipment SOP",
    detail:
      "Lifejackets, VHF Channel 16, AIS-140 transponders, flares. Mandatory beyond three nautical miles.",
  },
  {
    name: "IMO",
    doc: "SOLAS V / Reg. 34",
    detail:
      "Voyage planning against charts, tidal windows and alternate anchorages before proceeding to sea.",
  },
];

const PIPELINE: TrackStep[] = [
  {
    agent: "Planner",
    title: "Read the question",
    role: "Works out what the question is actually asking — a craft type, a place, an hour — and which observations an honest answer needs.",
    emits: "A resolved intent and the list of agents to run",
  },
  {
    agent: "LocationTimeResolver",
    title: "Fix the position and the hour",
    role: "Turns “near Digha tomorrow morning” into coordinates, a depth, a nearest harbour and a bounded forecast window.",
    emits: "Latitude, longitude, region type, resolved time window",
  },
  {
    agent: "WeatherAgent",
    title: "Sound the atmosphere",
    role: "Pulls live wind speed and gusts, direction, visibility, precipitation and pressure for the fixed position.",
    emits: "Observed weather with its provider and timestamp",
    fallback: "The run is marked degraded — no figure is invented",
  },
  {
    agent: "OceanAgent",
    title: "Sound the water column",
    role: "Reads wave height, swell height and period, sea-surface temperature, current set and drift, and the tide phase.",
    emits: "Sea state, Douglas index, tide phase",
    fallback: "The run is marked degraded — no figure is invented",
  },
  {
    agent: "SatelliteAgent",
    title: "Find the most recent pass",
    role: "Searches the Copernicus Sentinel catalogue for the nearest recent acquisition over the position and reports its age.",
    emits: "Product identifiers, acquisition time, cloud cover",
    fallback: "Reported unavailable rather than simulated",
  },
  {
    agent: "RiskEngine",
    title: "Score the launch",
    role: "Runs a deterministic threshold engine alongside an XGBoost model, and attributes the score to the features that drove it.",
    emits: "Risk level, confidence, per-feature contributions",
    fallback: "Deterministic rules alone, flagged in the trace",
  },
  {
    agent: "GisAgent",
    title: "Draw the water",
    role: "Assembles hazard zones, precaution zones, safe corridors, port shelters and buoy stations as chart layers.",
    emits: "GeoJSON layers keyed to risk level",
  },
  {
    agent: "EvidenceRetrieval",
    title: "Find the rule that governs it",
    role: "Embeds the question with BGE-M3 and searches Qdrant for the passages and compliance rules that apply.",
    emits: "Ranked evidence with authority and compliance rule",
    fallback: "Lexical retrieval, and the trace says so",
  },
  {
    agent: "ResponseGrounding",
    title: "Write the advisory",
    role: "Composes the answer against the retrieved evidence, in the language the question was asked in, naming what is restricted and what is permitted.",
    emits: "Grounded advisory, craft restrictions, statutory notice",
  },
];

const BOUNDARIES = [
  {
    head: "The model is not validated for this coast",
    body: "The committed XGBoost model is explicitly flagged as unvalidated for the Indian coastal deployment domain. Every response carries that flag rather than burying it.",
  },
  {
    head: "Satellite means catalogue, not imagery analysis",
    body: "ORCA-X searches Copernicus Sentinel catalogue metadata and reports what passed overhead and when. It does not derive features from the pixels.",
  },
  {
    head: "Degraded runs announce themselves",
    body: "When a weather, ocean or retrieval provider fails, the response is marked degraded and the trace names the fallback. Synthetic telemetry is never substituted for a live measurement.",
  },
  {
    head: "It does not outrank the authorities",
    body: "ORCA-X is decision support. It does not supersede statutory warnings from INCOIS, IMD, the Maritime Rescue Coordination Centres or any competent authority.",
  },
];

/* ---------------------------------------------------------------------------
   Depth gauge — a fixed sounder readout tying scroll position to the metaphor
   ------------------------------------------------------------------------ */

const MAX_DEPTH = 1000;

const DepthGauge: React.FC = () => {
  const { scrollYProgress } = useScroll();
  const smooth = useSpring(scrollYProgress, {
    stiffness: 80,
    damping: 24,
    restDelta: 0.001,
  });
  const depth = useTransform(smooth, [0, 1], [0, MAX_DEPTH]);
  const fillHeight = useTransform(smooth, (v) => `${v * 100}%`);
  const markerTop = useTransform(smooth, (v) => `calc(${v * 100}% - 3.5px)`);
  const [reading, setReading] = useState(0);

  useMotionValueEvent(depth, "change", (v) => setReading(Math.round(v)));

  return (
    <div
      aria-hidden="true"
      className="pointer-events-none fixed right-6 top-1/2 z-30 hidden -translate-y-1/2 flex-col items-end gap-3 xl:flex"
    >
      <span className="font-mono text-[10px] italic tabular-nums text-shoal">
        &minus;{reading.toLocaleString("en-IN")}&thinsp;m
      </span>
      <div className="relative h-52 w-px bg-shoal/15">
        <motion.div
          className="absolute inset-x-0 top-0 bg-gradient-to-b from-shoal to-buoy"
          style={{ height: fillHeight }}
        />
        <motion.span
          className="absolute -right-[3px] h-[7px] w-[7px] rotate-45 border border-buoy bg-abyssal"
          style={{ top: markerTop }}
        />
      </div>
      <span className="plate-label [writing-mode:vertical-rl]">Sounder</span>
    </div>
  );
};

/* ---------------------------------------------------------------------------
   Page
   ------------------------------------------------------------------------ */

interface SynopsisPageProps {
  onEnterConsole: () => void;
}

export const SynopsisPage: React.FC<SynopsisPageProps> = ({ onEnterConsole }) => {
  const heroRef = useRef<HTMLDivElement>(null);
  const { scrollYProgress } = useScroll();
  const fieldY = useTransform(scrollYProgress, [0, 1], ["0%", "12%"]);
  const fieldOpacity = useTransform(scrollYProgress, [0, 0.35, 1], [1, 0.7, 0.32]);
  const [isAudioActive, setIsAudioActive] = useState<boolean>(false);

  useEffect(() => {
    const unsubscribe = hydrophoneEngine.subscribe((active) => {
      setIsAudioActive(active);
    });
    return () => unsubscribe();
  }, []);

  const handleToggleAudio = () => {
    hydrophoneEngine.toggleAudio();
  };

  // The page-load sequence: the headline rises line by line, then the rail and
  // the actions settle in behind it. One orchestrated moment, not scattered effects.
  //
  // `useLayoutEffect`, not `useEffect`: the hero lines start at
  // `motion-safe:opacity-0`, so this has to claim them before the browser
  // paints. On `useEffect` the first frame would show a blank headline.
  useLayoutEffect(() => {
    const root = heroRef.current;
    if (!root) return;

    const lines = root.querySelectorAll<HTMLElement>("[data-hero-line]");
    const tail = root.querySelectorAll<HTMLElement>("[data-hero-tail]");

    return withMotion(
      () => {
        const tl = createTimeline({ defaults: { ease: "out(3)" } });
        tl.add(lines, {
          y: ["112%", "0%"],
          opacity: [0, 1],
          duration: 980,
          delay: stagger(110),
        }).add(
          tail,
          {
            y: [16, 0],
            opacity: [0, 1],
            duration: 720,
            delay: stagger(90),
          },
          "-=520",
        );
        return tl;
      },
      () => {
        [...lines, ...tail].forEach((node) => {
          node.style.opacity = "1";
          node.style.transform = "none";
        });
      },
    );
  }, []);

  // Activate silk-smooth Lenis momentum scrolling
  useLenis();

  const stations = Object.values(COASTAL_LOCATIONS).map(
    (loc) => `${loc.name} · ${loc.state ?? loc.country} · ${loc.depthMeters ?? "—"} m`,
  );

  return (
    <div className="relative min-h-screen overflow-x-clip bg-abyssal/20 text-chartpaper selection:bg-shoal/20 selection:text-shoal">
      {/* Live Cinematic Frame-by-Frame Scrollytelling Canvas Background - FULLY PROMINENT */}
      <ScrollyCanvasBackground />

      <DepthGauge />

      {/* ---- Top rail ---------------------------------------------------- */}
      <header className="sticky top-0 z-40 border-b border-shoal/20 bg-abyssal/75 backdrop-blur-xl shadow-lg shadow-abyssal/50">
        <div className="mx-auto flex max-w-6xl items-center justify-between gap-4 px-5 py-3.5 sm:px-8">
          <div className="flex items-center gap-3">
            <span className="flex h-8 w-8 items-center justify-center rounded-lg border border-shoal/40 bg-shoal/10 shadow-sm shadow-shoal/20">
              <Waves className="h-4 w-4 text-shoal" />
            </span>
            <span className="font-display text-base font-bold tracking-tight text-chartpaper">
              ORCA&#8209;X
            </span>
            <span className="hidden font-mono text-[10px] tracking-[0.2em] text-fathom sm:inline">
              OCEAN REASONING &amp; COLLABORATIVE AI
            </span>
          </div>

          <div className="flex items-center gap-4">
            <button
              onClick={handleToggleAudio}
              title={isAudioActive ? "Mute hydrophone audio" : "Enable hydrophone ocean audio"}
              className={`flex items-center gap-2 rounded-full border px-3 py-1 font-mono text-[10px] uppercase tracking-[0.15em] transition-all ${
                isAudioActive
                  ? "border-shoal/60 bg-shoal/20 text-shoal shadow-sm shadow-shoal/30"
                  : "border-shoal/25 bg-abyssal/60 text-fathom hover:border-shoal/50 hover:text-shoal backdrop-blur-md"
              }`}
            >
              {isAudioActive ? (
                <>
                  <Volume2 className="h-3.5 w-3.5 text-shoal animate-pulse" />
                  <span>Hydrophone On</span>
                </>
              ) : (
                <>
                  <VolumeX className="h-3.5 w-3.5 text-fathom" />
                  <span>Hydrophone Off</span>
                </>
              )}
            </button>

            <button
              onClick={onEnterConsole}
              className="group flex items-center gap-2 rounded-full border border-shoal/30 bg-shoal/10 px-4 py-1.5 font-mono text-[10px] uppercase tracking-[0.2em] text-shoal shadow-sm transition-all duration-300 hover:border-shoal/60 hover:bg-shoal/20 hover:text-white"
            >
              Live console
              <ArrowRight className="h-3.5 w-3.5 transition-transform duration-300 group-hover:translate-x-1" />
            </button>
          </div>
        </div>
      </header>

      <main className="relative z-10">
        {/* ---- Hero ------------------------------------------------------ */}
        <section
          ref={heroRef}
          className="mx-auto max-w-6xl px-5 pb-16 pt-12 sm:px-8 sm:pb-24 sm:pt-20"
        >
          <div
            data-hero-tail
            className="mb-6 flex flex-wrap items-center gap-x-4 gap-y-2"
          >
            <span className="rounded-full border border-cyan-400/50 bg-black/50 px-3.5 py-1 font-mono text-[11px] font-bold tracking-[0.16em] text-cyan-300 backdrop-blur-sm shadow-md">
              Smart India Hackathon
            </span>
            <span aria-hidden="true" className="h-px w-8 bg-cyan-400/50" />
            <span className="flex items-center gap-2 font-mono text-[11px] font-bold tracking-[0.16em] text-emerald-300 drop-shadow-[0_2px_6px_rgba(0,0,0,0.95)]">
              <span className="relative flex h-2 w-2">
                <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-emerald-400/70" />
                <span className="relative inline-flex h-2 w-2 rounded-full bg-emerald-400" />
              </span>
              REAL-TIME MARINE DECISION SUPPORT
            </span>
          </div>

          <h1 className="font-display text-[2.75rem] font-black leading-[1.02] tracking-[-0.03em] text-white drop-shadow-[0_3px_14px_rgba(0,0,0,0.95)] sm:text-6xl lg:text-[4.75rem]">
            <span className="block overflow-hidden pb-1">
              <span data-hero-line className="block">
                Every forecast this coast
              </span>
            </span>
            <span className="block overflow-hidden pb-1">
              <span data-hero-line className="block">
                needs already exists.
              </span>
            </span>
            <span className="block overflow-hidden pb-1">
              <span data-hero-line className="block text-cyan-300 drop-shadow-[0_2px_16px_rgba(6,182,212,0.8)]">
                None of it arrives
              </span>
            </span>
            <span className="block overflow-hidden pb-1">
              <span data-hero-line className="block text-cyan-300 drop-shadow-[0_2px_16px_rgba(6,182,212,0.8)]">
                as an answer.
              </span>
            </span>
          </h1>

          <p
            data-hero-tail
            className="mt-8 max-w-2xl text-[16.5px] font-medium leading-relaxed text-slate-100 drop-shadow-[0_2px_8px_rgba(0,0,0,0.95)] sm:text-[18px]"
          >
            ORCA&#8209;X reads one question — asked in Bengali, Hindi, Tamil, Odia,
            Telugu or English — and answers it with a single decision: whether
            this craft can leave this harbour in this window. It sounds the live
            atmosphere and water column, scores the launch, and cites the
            authority whose rule governs the call.
          </p>

          <div
            data-hero-tail
            className="mt-10 flex flex-col gap-3.5 sm:flex-row sm:items-center sm:gap-4"
          >
            <AttractButton onClick={onEnterConsole}>
              Open the live console
              <ArrowRight className="h-3.5 w-3.5" />
            </AttractButton>
            <a
              href="#method"
              className="group inline-flex items-center justify-center gap-2.5 rounded-full border border-cyan-400/40 bg-black/40 px-7 py-3.5 font-mono text-[11px] font-bold uppercase tracking-[0.22em] text-cyan-300 backdrop-blur-sm shadow-md transition-all duration-300 hover:border-cyan-400 hover:bg-cyan-500/20 hover:text-white"
            >
              Follow the pipeline
              <ArrowDown className="h-3.5 w-3.5 transition-transform duration-300 group-hover:translate-y-0.5" />
            </a>
          </div>

          {/* The four numbers that actually decide a launch - Clean Columns, NO Gradient Boxes */}
          <div
            data-hero-tail
            className="mt-14 grid grid-cols-2 gap-6 border-t-2 border-cyan-400/40 pt-8 lg:grid-cols-4"
          >
            {LAUNCH_THRESHOLDS.map((item) => (
              <div
                key={item.label}
                className="border-l-2 border-cyan-400/60 pl-4 py-1"
              >
                <div className="font-display text-3xl font-black tracking-tight text-cyan-300 drop-shadow-[0_2px_12px_rgba(0,0,0,0.95)] sm:text-4xl">
                  <SoundingNumber
                    value={item.value}
                    precision={item.precision}
                    suffix={item.suffix}
                  />
                </div>
                <div className="mt-2 text-[14px] font-bold text-white drop-shadow-[0_2px_6px_rgba(0,0,0,0.95)]">
                  {item.label}
                </div>
                <p className="mt-1 text-[12.5px] font-medium leading-snug text-slate-100 drop-shadow-[0_1px_4px_rgba(0,0,0,0.95)]">
                  {item.note}
                </p>
                <span className="mt-2.5 inline-block font-mono text-[10.5px] font-bold tracking-widest text-amber-300 drop-shadow">
                  {item.authority}
                </span>
              </div>
            ))}
          </div>

          <p className="mt-6 max-w-2xl text-[13px] font-medium leading-relaxed text-slate-200 drop-shadow-[0_1px_4px_rgba(0,0,0,0.95)]">
            These are the published limits, not our estimates. The work is
            getting them to the person standing on the sand at four in the
            morning.
          </p>

          {/* ---- Interactive Coastal Hub Surveillance Map ---- */}
          <div className="mt-12 overflow-hidden rounded-2xl border border-cyan-400/40 bg-black/40 p-3 sm:p-5 shadow-xl backdrop-blur-sm">
            <div className="mb-3 flex items-center justify-between px-2">
              <div className="flex items-center gap-2 font-mono text-[10.5px] font-bold uppercase tracking-[0.16em] text-cyan-300 drop-shadow">
                <Compass className="h-3.5 w-3.5 text-cyan-300 animate-spin [animation-duration:12s]" />
                <span>Interactive Coastal Hub Surveillance Map</span>
              </div>
              <span className="font-mono text-[10px] text-cyan-200 font-bold hidden sm:inline drop-shadow">
                CLICK ANY STATION TO PROBE
              </span>
            </div>
            <IndianCoastalMap onSelectPort={() => onEnterConsole()} />
          </div>
        </section>

        {/* ---- Station rail ---------------------------------------------- */}
        <section className="border-y border-cyan-400/20 bg-black/50 py-4 backdrop-blur-md">
          <Marquee items={stations} />
        </section>

        {/* ---- −12 m · The gap ------------------------------------------- */}
        <section className="mx-auto max-w-6xl px-5 py-16 sm:px-8 sm:py-24">
          <Reveal>
            <DepthMarker depth={12} label="Where the problem begins" />
          </Reveal>

          <Reveal delay={0.08}>
            <h2 className="mt-7 max-w-3xl font-display text-3xl font-black leading-[1.08] tracking-[-0.02em] text-white drop-shadow-[0_2px_12px_rgba(0,0,0,0.95)] sm:text-[2.75rem]">
              Nothing is missing. Everything is scattered.
            </h2>
          </Reveal>

          <Reveal delay={0.14}>
            <p className="mt-5 max-w-2xl text-[16px] font-medium leading-relaxed text-slate-100 drop-shadow-[0_1px_5px_rgba(0,0,0,0.9)]">
              Five authorities publish everything needed to keep a small craft
              alive off the Indian coast. They publish it in five formats, on
              five schedules, for five different readers — and none of those
              readers is one skipper deciding whether to launch in the next six
              hours.
            </p>
          </Reveal>

          <div className="mt-12 grid gap-8 lg:grid-cols-3">
            {[
              {
                icon: <BookOpen className="h-5 w-5 text-cyan-300" />,
                sheet: "Fragmentation",
                head: "Five sources, five formats",
                body: "An ocean-state forecast, a squall bulletin, a fishing-zone advisory, an equipment SOP and a voyage-planning regulation. Each authoritative. None of them speaks to the others.",
              },
              {
                icon: <Compass className="h-5 w-5 text-cyan-300" />,
                sheet: "Resolution",
                head: "Sea areas, not harbours",
                body: "A bulletin covers a sea area for a day. The decision is a specific launch, from a specific beach, inside a specific window — at a depth and tide the bulletin never mentions.",
              },
              {
                icon: <Globe className="h-5 w-5 text-cyan-300" />,
                sheet: "Language",
                head: "Published in English, as prose",
                body: "The coast this serves reads Bengali, Odia, Tamil, Telugu and Hindi. A threshold buried in an English PDF is not a warning; it is a document.",
              },
            ].map((card, i) => (
              <Reveal key={card.sheet} delay={0.06 * i}>
                <div className="flex h-full flex-col border-t-2 border-cyan-400/50 pt-6">
                  <div className="flex items-center justify-between">
                    <span className="font-mono text-[11px] font-bold tracking-[0.2em] text-cyan-300 uppercase drop-shadow">
                      {card.sheet}
                    </span>
                    <span className="drop-shadow">{card.icon}</span>
                  </div>
                  <h3 className="mt-4 font-display text-2xl font-black leading-tight text-white drop-shadow-[0_2px_8px_rgba(0,0,0,0.95)]">
                    {card.head}
                  </h3>
                  <p className="mt-3 text-[15px] font-medium leading-relaxed text-slate-100 drop-shadow-[0_1px_4px_rgba(0,0,0,0.9)]">
                    {card.body}
                  </p>
                </div>
              </Reveal>
            ))}
          </div>

          {/* The corpus, listed plainly with clean rules — NO dark gradient box */}
          <Reveal delay={0.1}>
            <div className="mt-16 border-t-2 border-cyan-400/40 pt-8">
              <span className="font-mono text-xs font-bold uppercase tracking-[0.2em] text-cyan-300 drop-shadow">
                The corpus ORCA&#8209;X reconciles
              </span>
              <ul className="mt-6 divide-y divide-cyan-400/20 border-b border-cyan-400/20">
                {AUTHORITIES.map((a) => (
                  <li
                    key={a.name}
                    className="grid gap-2 py-4 sm:grid-cols-[10rem_13rem_1fr] sm:items-baseline sm:gap-6"
                  >
                    <span className="font-mono text-[13px] font-black tracking-wider text-amber-300 drop-shadow">
                      {a.name}
                    </span>
                    <span className="font-display text-[15px] font-bold text-cyan-200 drop-shadow">
                      {a.doc}
                    </span>
                    <span className="text-[14px] font-medium leading-relaxed text-slate-100 drop-shadow-[0_1px_4px_rgba(0,0,0,0.9)]">
                      {a.detail}
                    </span>
                  </li>
                ))}
              </ul>
            </div>
          </Reveal>
        </section>

        {/* ---- −40 m · The instrument ------------------------------------ */}
        <section className="mx-auto max-w-6xl px-5 py-16 sm:px-8 sm:py-24">
          <Reveal>
            <DepthMarker depth={40} label="What ORCA-X does" />
          </Reveal>

          <Reveal delay={0.08}>
            <h2 className="mt-7 max-w-3xl font-display text-3xl font-black leading-[1.08] tracking-[-0.02em] text-white drop-shadow-[0_2px_12px_rgba(0,0,0,0.95)] sm:text-[2.75rem]">
              One question in. One decision out.
            </h2>
          </Reveal>

          <Reveal delay={0.14}>
            <p className="mt-5 max-w-2xl text-[16px] font-medium leading-relaxed text-slate-100 drop-shadow-[0_1px_5px_rgba(0,0,0,0.9)]">
              ORCA&#8209;X is a reconciliation layer, not another feed. Nine agents
              run against live providers, a risk engine and a retrieval index,
              and collapse the result into an advisory a skipper can act on —
              with every step of the reasoning left open to inspection.
            </p>
          </Reveal>

          <div className="mt-12 grid grid-cols-1 gap-10 sm:grid-cols-2 lg:grid-cols-6">
            {/* Plate A */}
            <Reveal className="lg:col-span-3">
              <div className="flex h-full flex-col border-t-2 border-cyan-400/50 pt-6">
                <div className="flex items-center justify-between">
                  <span className="font-mono text-[11px] font-bold tracking-[0.2em] text-cyan-300 uppercase drop-shadow">
                    Plate A
                  </span>
                  <Globe className="h-4 w-4 text-cyan-300 drop-shadow" />
                </div>
                <h3 className="mt-4 font-display text-2xl font-black leading-tight text-white drop-shadow-[0_2px_8px_rgba(0,0,0,0.95)]">
                  Ask in the language you think in
                </h3>
                <p className="mt-3 text-[15px] font-medium leading-relaxed text-slate-100 drop-shadow-[0_1px_4px_rgba(0,0,0,0.9)]">
                  Bengali, Hindi, Tamil, Odia, Telugu and English. The answer comes
                  back naming the craft types restricted and the craft types
                  permitted, in the same language — not a table of figures to
                  interpret.
                </p>
                <ul className="mt-5 flex flex-wrap gap-2">
                  {["বাংলা", "हिन्दी", "தமிழ்", "ଓଡ଼ିଆ", "తెలుగు", "English"].map(
                    (lang) => (
                      <li
                        key={lang}
                        className="rounded border border-cyan-400/60 bg-black/50 px-3 py-1 font-mono text-[11px] font-bold text-cyan-300 shadow-sm backdrop-blur-sm"
                      >
                        {lang}
                      </li>
                    ),
                  )}
                </ul>
              </div>
            </Reveal>

            {/* Plate B */}
            <Reveal delay={0.06} className="lg:col-span-3">
              <div className="flex h-full flex-col border-t-2 border-cyan-400/50 pt-6">
                <div className="flex items-center justify-between">
                  <span className="font-mono text-[11px] font-bold tracking-[0.2em] text-cyan-300 uppercase drop-shadow">
                    Plate B
                  </span>
                  <Radio className="h-4 w-4 text-cyan-300 drop-shadow" />
                </div>
                <h3 className="mt-4 font-display text-2xl font-black leading-tight text-white drop-shadow-[0_2px_8px_rgba(0,0,0,0.95)]">
                  Live observation, or an honest gap
                </h3>
                <p className="mt-3 text-[15px] font-medium leading-relaxed text-slate-100 drop-shadow-[0_1px_4px_rgba(0,0,0,0.9)]">
                  Weather and marine conditions come from live providers; satellite
                  passes from the Copernicus catalogue. When a provider fails,
                  ORCA&#8209;X marks the run degraded and names the fallback in the
                  trace.
                </p>
                <p className="mt-4 border-l-2 border-amber-400 pl-3.5 text-[13.5px] font-bold text-amber-300 drop-shadow">
                  A synthetic wave height is never substituted for a measured one.
                  An empty reading is safer than a confident guess.
                </p>
              </div>
            </Reveal>

            {/* Plate C */}
            <Reveal className="lg:col-span-2">
              <div className="flex h-full flex-col border-t-2 border-cyan-400/40 pt-6">
                <div className="flex items-center justify-between">
                  <span className="font-mono text-[11px] font-bold tracking-[0.2em] text-cyan-300 uppercase drop-shadow">
                    Plate C
                  </span>
                  <Activity className="h-4 w-4 text-cyan-300 drop-shadow" />
                </div>
                <h3 className="mt-4 font-display text-xl font-black text-white drop-shadow-[0_2px_8px_rgba(0,0,0,0.95)]">
                  A score you can take apart
                </h3>
                <p className="mt-3 text-[14.5px] font-medium leading-relaxed text-slate-100 drop-shadow-[0_1px_4px_rgba(0,0,0,0.9)]">
                  A deterministic threshold engine runs alongside an XGBoost model,
                  and every score is broken back down into the features that drove
                  it — wave height, gust, swell period, tide phase — with its weight
                  shown.
                </p>
              </div>
            </Reveal>

            {/* Plate D */}
            <Reveal delay={0.06} className="lg:col-span-2">
              <div className="flex h-full flex-col border-t-2 border-cyan-400/40 pt-6">
                <div className="flex items-center justify-between">
                  <span className="font-mono text-[11px] font-bold tracking-[0.2em] text-cyan-300 uppercase drop-shadow">
                    Plate D
                  </span>
                  <BookOpen className="h-4 w-4 text-cyan-300 drop-shadow" />
                </div>
                <h3 className="mt-4 font-display text-xl font-black text-white drop-shadow-[0_2px_8px_rgba(0,0,0,0.95)]">
                  Grounded in the actual rule
                </h3>
                <p className="mt-3 text-[14.5px] font-medium leading-relaxed text-slate-100 drop-shadow-[0_1px_4px_rgba(0,0,0,0.9)]">
                  Questions are embedded with BGE&#8209;M3 and searched against the
                  authority corpus in Qdrant. Advisories cite the document, the
                  publication date and the compliance rule they rest on.
                </p>
              </div>
            </Reveal>

            {/* Plate E */}
            <Reveal delay={0.12} className="lg:col-span-2">
              <div className="flex h-full flex-col border-t-2 border-cyan-400/40 pt-6">
                <div className="flex items-center justify-between">
                  <span className="font-mono text-[11px] font-bold tracking-[0.2em] text-cyan-300 uppercase drop-shadow">
                    Plate E
                  </span>
                  <Layers className="h-4 w-4 text-cyan-300 drop-shadow" />
                </div>
                <h3 className="mt-4 font-display text-xl font-black text-white drop-shadow-[0_2px_8px_rgba(0,0,0,0.95)]">
                  Drawn on the water
                </h3>
                <p className="mt-3 text-[14.5px] font-medium leading-relaxed text-slate-100 drop-shadow-[0_1px_4px_rgba(0,0,0,0.9)]">
                  Hazard zones, precaution zones, safe corridors, port shelters and
                  buoy stations are rendered as chart layers keyed to the current
                  risk level — so the advisory has a geography.
                </p>
              </div>
            </Reveal>

            {/* Plate F */}
            <Reveal className="lg:col-span-3">
              <div className="flex h-full flex-col border-t-2 border-cyan-400/40 pt-6">
                <div className="flex items-center justify-between">
                  <span className="font-mono text-[11px] font-bold tracking-[0.2em] text-cyan-300 uppercase drop-shadow">
                    Plate F
                  </span>
                  <SlidersHorizontal className="h-4 w-4 text-cyan-300 drop-shadow" />
                </div>
                <h3 className="mt-4 font-display text-2xl font-black text-white drop-shadow-[0_2px_8px_rgba(0,0,0,0.95)]">
                  Ask what would have to change
                </h3>
                <p className="mt-3 text-[15px] font-medium leading-relaxed text-slate-100 drop-shadow-[0_1px_4px_rgba(0,0,0,0.9)]">
                  The what&#8209;if studio perturbs wind, swell and tide against the same
                  engine, so a harbour master can find the exact condition that
                  flips a launch from permitted to restricted — and how much margin
                  is left.
                </p>
              </div>
            </Reveal>

            {/* Plate G */}
            <Reveal delay={0.06} className="lg:col-span-3">
              <div className="flex h-full flex-col border-t-2 border-cyan-400/40 pt-6">
                <div className="flex items-center justify-between">
                  <span className="font-mono text-[11px] font-bold tracking-[0.2em] text-cyan-300 uppercase drop-shadow">
                    Plate G
                  </span>
                  <Satellite className="h-4 w-4 text-cyan-300 drop-shadow" />
                </div>
                <h3 className="mt-4 font-display text-2xl font-black text-white drop-shadow-[0_2px_8px_rgba(0,0,0,0.95)]">
                  Watch it think
                </h3>
                <p className="mt-3 text-[15px] font-medium leading-relaxed text-slate-100 drop-shadow-[0_1px_4px_rgba(0,0,0,0.9)]">
                  Every run publishes its own execution trace: which agent ran, how
                  long it took, what it received, what it emitted and where it fell
                  back. The reasoning is a first&#8209;class output, not a log file.
                </p>
              </div>
            </Reveal>
          </div>
        </section>

        {/* ---- −200 m · The track --------------------------------------- */}
        <section
          id="method"
          className="mx-auto max-w-6xl scroll-mt-20 px-5 py-16 sm:px-8 sm:py-24"
        >
          <Reveal>
            <DepthMarker depth={200} label="The pipeline, fix by fix" />
          </Reveal>

          <Reveal delay={0.08}>
            <h2 className="mt-7 max-w-3xl font-display text-3xl font-black leading-[1.08] tracking-[-0.02em] text-white drop-shadow-[0_2px_12px_rgba(0,0,0,0.95)] sm:text-[2.75rem]">
              A plotted course from question to advisory.
            </h2>
          </Reveal>

          <Reveal delay={0.14}>
            <p className="mt-5 max-w-2xl text-[16px] font-medium leading-relaxed text-slate-100 drop-shadow-[0_1px_5px_rgba(0,0,0,0.9)]">
              Nine agents run in order, each one leaving a fix on the record. The
              console shows this same track live, with real durations — so an
              operator can see precisely where an answer came from, and where it
              had to compromise.
            </p>
          </Reveal>

          {/* Plotted track — NO enclosing dark gradient box */}
          <div className="mt-14 border-t-2 border-cyan-400/40 pt-10">
            <TrackLine steps={PIPELINE} />

            <Reveal>
              <div className="mt-10 flex flex-wrap items-center gap-x-8 gap-y-3 border-t border-cyan-400/30 pt-6 font-mono text-[12px] tracking-[0.16em] text-slate-200">
                <span>
                  <span className="text-cyan-300 font-black">9</span> AGENTS
                </span>
                <span>
                  <span className="text-cyan-300 font-black">4</span> SERVICES
                </span>
                <span>
                  <span className="text-cyan-300 font-black">1024</span>&#8209;DIM EMBEDDINGS
                </span>
                <span>
                  <span className="text-cyan-300 font-black">17</span> STATIONS
                </span>
                <span>
                  <span className="text-cyan-300 font-black">6</span> LANGUAGES
                </span>
              </div>
            </Reveal>
          </div>
        </section>

        {/* ---- −620 m · The limits -------------------------------------- */}
        <section className="mx-auto max-w-6xl px-5 py-16 sm:px-8 sm:py-24">
          <Reveal>
            <DepthMarker depth={620} label="What it will not claim" />
          </Reveal>

          <Reveal delay={0.08}>
            <h2 className="mt-7 max-w-3xl font-display text-3xl font-black leading-[1.08] tracking-[-0.02em] text-white drop-shadow-[0_2px_12px_rgba(0,0,0,0.95)] sm:text-[2.75rem]">
              The boundaries are part of the output.
            </h2>
          </Reveal>

          <Reveal delay={0.14}>
            <p className="mt-5 max-w-2xl text-[16px] font-medium leading-relaxed text-slate-100 drop-shadow-[0_1px_5px_rgba(0,0,0,0.9)]">
              A safety tool that hides its own limits is a hazard. ORCA&#8209;X
              surfaces these four through the workflow trace on every single run,
              so nobody mistakes an unavailable capability for a completed one.
            </p>
          </Reveal>

          {/* Boundaries — Clean, unboxed left-accent columns */}
          <div className="mt-12 grid gap-8 sm:grid-cols-2">
            {BOUNDARIES.map((item, i) => (
              <Reveal key={item.head} delay={0.05 * i}>
                <div className="h-full border-l-2 border-amber-400 pl-5 py-2">
                  <div className="flex items-start gap-3">
                    <ShieldCheck className="mt-0.5 h-5 w-5 shrink-0 text-amber-400 drop-shadow" />
                    <h3 className="font-display text-xl font-bold leading-tight text-amber-200 drop-shadow">
                      {item.head}
                    </h3>
                  </div>
                  <p className="mt-3 pl-8 text-[14.5px] font-medium leading-relaxed text-slate-100 drop-shadow-[0_1px_3px_rgba(0,0,0,0.9)]">
                    {item.body}
                  </p>
                </div>
              </Reveal>
            ))}
          </div>
        </section>

        {/* ---- −1000 m · Enter the console ------------------------------ */}
        <section className="mx-auto max-w-6xl px-5 pb-24 pt-10 sm:px-8 sm:pb-32">
          <Reveal>
            <div className="border-t-2 border-cyan-400/40 pt-16 text-center">
              <DepthMarker
                depth={1000}
                label="Working depth"
                className="justify-center [&>span:last-child]:hidden"
              />

              <h2 className="mx-auto mt-8 max-w-2xl font-display text-3xl font-black leading-[1.05] tracking-[-0.025em] text-white drop-shadow-[0_3px_14px_rgba(0,0,0,0.95)] sm:text-5xl">
                Put a real question to it.
              </h2>

              <p className="mx-auto mt-6 max-w-xl text-[16px] font-medium leading-relaxed text-slate-100 drop-shadow-[0_1px_4px_rgba(0,0,0,0.9)]">
                The console opens on a live run against Digha and answers in
                the language you pick. Every figure it shows is a measurement
                or is marked as missing.
              </p>

              <div className="mt-10 flex flex-col items-center justify-center gap-3 sm:flex-row sm:gap-4">
                <AttractButton onClick={onEnterConsole}>
                  Open the live console
                  <Anchor className="h-3.5 w-3.5" />
                </AttractButton>
              </div>

              <p className="mx-auto mt-8 max-w-lg font-mono text-[11px] font-medium tracking-wide text-cyan-200 drop-shadow">
                Requires the API on port 3000. Risk scoring and evidence
                retrieval degrade gracefully and say so when the ML and RAG
                services are not running.
              </p>
            </div>
          </Reveal>
        </section>
      </main>

      {/* ---- Statutory footer ------------------------------------------- */}
      <footer className="relative z-10 border-t border-shoal/12 bg-abyssal/85">
        <div className="mx-auto flex max-w-6xl flex-col gap-4 px-5 py-8 sm:flex-row sm:items-start sm:justify-between sm:px-8">
          <div className="flex items-center gap-3">
            <Waves className="h-4 w-4 text-shoal" />
            <span className="font-display text-sm font-bold">ORCA&#8209;X</span>
            <span className="font-mono text-[10px] tracking-[0.16em] text-fathom">
              INCOIS · IMD · CMFRI · ICG · IMO
            </span>
          </div>
          <p className="max-w-xl text-[11.5px] leading-relaxed text-fathom sm:text-right">
            <strong className="text-slate-300">Statutory notice.</strong>{" "}
            ORCA&#8209;X is a decision&#8209;support system. It does not supersede
            warnings, advisories or instructions issued by INCOIS, the India
            Meteorological Department, the Maritime Rescue Coordination Centres
            or any other competent authority.
          </p>
        </div>
      </footer>
    </div>
  );
};

export default SynopsisPage;
