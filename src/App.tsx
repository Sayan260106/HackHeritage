import React, { useEffect } from "react";
import { AnimatePresence, motion } from "motion/react";
import { useHashRoute } from "./hooks/useHashRoute";
import { usePrefersReducedMotion } from "./hooks/usePrefersReducedMotion";
import SynopsisPage from "./pages/SynopsisPagePremium";
import ConsolePage from "./pages/ConsolePage";

/**
 * ORCA-X has two destinations: the project story and the live console.
 * The landing is intentionally cinematic; the console remains the functional
 * application and is not changed by the landing redesign.
 */
export default function App() {
  const { route, navigate } = useHashRoute();
  const reduced = usePrefersReducedMotion();

  useEffect(() => {
    document.title =
      route === "console"
        ? "ORCA-X — Live Console"
        : "ORCA-X — Ocean Reasoning & Collaborative AI";
  }, [route]);

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
