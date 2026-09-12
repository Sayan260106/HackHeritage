import React, { useEffect } from "react";
import { AnimatePresence, motion } from "motion/react";
import { useHashRoute } from "./hooks/useHashRoute";
import { usePrefersReducedMotion } from "./hooks/usePrefersReducedMotion";
import SynopsisPage from "./pages/SynopsisPage";
import ConsolePage from "./pages/ConsolePage";
import SimulatorPage from "./pages/SimulatorPage";

/**
 * ORCA-X destinations: project brief, live console, and 2G keypad simulator.
 */
export default function App() {
  const { route, navigate } = useHashRoute();
  const reduced = usePrefersReducedMotion();

  // The document title follows the route so browser history stays legible.
  useEffect(() => {
    document.title =
      route === "console"
        ? "ORCA-X — Live Console"
        : route === "simulator"
        ? "ORCA-X — 2G Keypad IVR Simulator"
        : "ORCA-X — Ocean Reasoning & Collaborative AI";
  }, [route]);

  /**
   * Opacity and offset transition.
   */
  const dive = reduced
    ? { initial: false as const, animate: {}, exit: {} }
    : {
        initial: { opacity: 0, y: 26 },
        animate: { opacity: 1, y: 0 },
        exit: { opacity: 0, y: -18 },
      };

  return (
    <AnimatePresence mode="wait" initial={false}>
      <motion.div
        key={route}
        initial={dive.initial}
        animate={dive.animate}
        exit={dive.exit}
        transition={
          reduced ? { duration: 0 } : { duration: 0.52, ease: [0.22, 1, 0.36, 1] }
        }
      >
        {route === "console" ? (
          <ConsolePage onExit={() => navigate("brief")} />
        ) : route === "simulator" ? (
          <SimulatorPage onExit={() => navigate("console")} />
        ) : (
          <SynopsisPage onEnterConsole={() => navigate("console")} />
        )}
      </motion.div>
    </AnimatePresence>
  );
}
