import React, { useEffect } from "react";
import { AnimatePresence, motion } from "motion/react";
import { useHashRoute } from "./hooks/useHashRoute";
import { usePrefersReducedMotion } from "./hooks/usePrefersReducedMotion";
import SynopsisPage from "./pages/SynopsisPage";
import ConsolePage from "./pages/ConsolePage";

/**
 * ORCA-X has two destinations: the project brief, and the live console. The
 * transition between them reads as a dive — the outgoing page sinks and dims
 * while the incoming one rises into place.
 */
export default function App() {
  const { route, navigate } = useHashRoute();
  const reduced = usePrefersReducedMotion();

  // The document title follows the route so browser history stays legible.
  useEffect(() => {
    document.title =
      route === "console"
        ? "ORCA-X — Live Console"
        : "ORCA-X — Ocean Reasoning & Collaborative AI";
  }, [route]);

  /**
   * Opacity and offset only — deliberately no `filter`. A filter value other
   * than `none` (including `blur(0px)`) makes the element a containing block
   * for fixed-position descendants, which would strand the brief's parallax
   * plate, its depth gauge, the console's mobile drawer and the map's
   * fullscreen mode. The dive reads fine without it.
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
        ) : (
          <SynopsisPage onEnterConsole={() => navigate("console")} />
        )}
      </motion.div>
    </AnimatePresence>
  );
}
