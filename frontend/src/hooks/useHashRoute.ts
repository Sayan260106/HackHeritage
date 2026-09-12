import { useCallback, useEffect, useState } from "react";

export type Route = "brief" | "console" | "simulator";

/** `#/console` opens the live console; `#/simulator` opens 2G keypad simulator; anything else opens brief. */
function readRoute(): Route {
  const hash = window.location.hash.replace(/^#\/?/, "");
  if (hash === "console") return "console";
  if (hash === "simulator" || hash === "keypad" || hash === "ivr") return "simulator";
  return "brief";
}

/**
 * Hash-based routing for brief, console, and 2G keypad simulator.
 */
export function useHashRoute() {
  const [route, setRoute] = useState<Route>(() =>
    typeof window === "undefined" ? "brief" : readRoute(),
  );

  useEffect(() => {
    const sync = () => setRoute(readRoute());
    window.addEventListener("hashchange", sync);
    return () => window.removeEventListener("hashchange", sync);
  }, []);

  const navigate = useCallback((next: Route) => {
    let target = "#/";
    if (next === "console") target = "#/console";
    if (next === "simulator") target = "#/simulator";

    if (window.location.hash === target) {
      setRoute(next);
      return;
    }
    window.location.hash = target;
    window.scrollTo({ top: 0, behavior: "auto" });
  }, []);

  return { route, navigate };
}
