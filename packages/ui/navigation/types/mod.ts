/** @projective/ui/navigation — shell types. */

/**
 * Visibility gate for the global shell (DESIGN_SYSTEM.md Part D). `user` shows the Red-zone sidebar
 * (full nested matrix); `guest` hides it (top header framing the canvas directly).
 */
export type Persona = "user" | "guest";

/** Nested-frame surface tone (0 = `--surface` … 3 = `--surface-3`). */
export type FrameSurface = 0 | 1 | 2 | 3;

/** Middle-nav (Blue) density derived from the Splitter width (Part D.2). */
export type LaneMode = "collapsed" | "compact" | "full";
