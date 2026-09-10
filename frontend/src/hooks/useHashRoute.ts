import { useCallback, useEffect, useState } from "react";

export type Route = "brief" | "console";

/** `#/console` opens the live console; anything else opens the brief. */
function readRoute(): Route {
  return window.location.hash.replace(/^#\/?/, "") === "console"
    ? "console"
    : "brief";
}

/**
 * Two-page routing on the URL hash. Deliberately dependency-free: ORCA-X has
 * exactly two destinations, and a hash keeps the console linkable and
 * back-button friendly without adding a router to the bundle.
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
    const target = next === "console" ? "#/console" : "#/";
    if (window.location.hash === target) {
      setRoute(next);
      return;
    }
    window.location.hash = target;
    window.scrollTo({ top: 0, behavior: "auto" });
  }, []);

  return { route, navigate };
}
