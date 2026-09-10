/**
 * anime.js access point.
 *
 * Every anime.js call in ORCA-X routes through this module so the library's
 * API surface is pinned in exactly one file. anime.js v4 (see package.json)
 * exposes named ESM exports; if the dependency is ever moved to v3, this is the
 * only file that needs to change.
 */
import { animate, createTimeline, stagger, svg, utils } from "animejs";

export { animate, createTimeline, stagger, svg, utils };

/** True when the visitor has not asked the interface to hold still. */
export function motionOK(): boolean {
  if (typeof window === "undefined" || !window.matchMedia) return false;
  return !window.matchMedia("(prefers-reduced-motion: reduce)").matches;
}

/** Anything anime.js hands back that knows how to undo itself. */
interface Revertible {
  revert?: () => void;
}

/**
 * Narrowed at runtime rather than asserted, because `build` is deliberately
 * typed loosely: callers may return an animation, a timeline, or nothing at all.
 */
function isRevertible(value: unknown): value is Revertible {
  return typeof value === "object" && value !== null && "revert" in value;
}

/**
 * Runs an anime.js sequence only when motion is welcome, and hands back a
 * cleanup function suitable for returning straight out of a layout effect.
 *
 * When motion is reduced, `settle` runs instead so elements land in their final
 * state rather than never appearing at all.
 */
export function withMotion(build: () => unknown, settle?: () => void): () => void {
  if (!motionOK()) {
    settle?.();
    return () => {};
  }

  let instance: unknown;
  try {
    instance = build();
  } catch (error) {
    /**
     * The elements these sequences animate start hidden, so a throw in here
     * would leave the hero and its calls to action permanently invisible.
     * Settling is the safe failure: the content appears, just without the
     * entrance.
     */
    console.error("Animation failed; settling to final state instead.", error);
    settle?.();
    return () => {};
  }

  return () => {
    if (isRevertible(instance)) instance.revert?.();
  };
}
