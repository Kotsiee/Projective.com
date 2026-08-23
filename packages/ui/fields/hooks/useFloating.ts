/**
 * Package-level re-export of the canonical anchored positioner.
 *
 * This module used to carry a SECOND, divergent copy of `useFloating` — the same duplication that
 * let `fields/hooks/useDismiss.ts` drift until one Escape press closed a different surface depending
 * on incidental render order. The fields copy knew only the two vertical sides, clamped horizontally
 * and never vertically, had no boundary model at all, and never repositioned when the panel's own
 * content changed size. So a field panel opened in a laned surface still overlapped the sidebar that
 * `avoid` exists to clear (`fields/types/mod.ts` has declared `OverlayFieldProps` for that since
 * Decision #19 and no field could honour it), and an AutoComplete whose suggestions arrived after
 * open kept the position computed for its empty height.
 *
 * The two are now one. The canonical hook's options are a strict superset:
 *
 * - `Placement` widens from four values to twelve. Every fields call site passes `bottom-start`, and
 *   no consumer outside this package names the type, so nothing narrows on it.
 * - `matchWidth` defaults to `false` rather than `true`. That is not a behaviour change here: the
 *   canonical hook always reports `width` as the TRIGGER's width (which is what `--float-width`
 *   consumers want), and uses the flag only to decide whether the collision math reasons about the
 *   trigger's width or the panel's measured one — which is what the fields copy did unconditionally.
 * - `availableHeight`/`availableWidth` widen to `number | null`, `null` meaning "unbounded on that
 *   side". Only an `allowOverflow` edge produces it and no field passes one, but every consumer
 *   interpolating the value into a CSS length must still test for `null` rather than assume a number.
 */
export { computePosition, resolveBoundaries, useFloating } from "../../hooks/useFloating.ts";
export type {
	BoundaryRect,
	BoundarySource,
	FloatingState,
	Placement,
	Side,
	UseFloatingOptions,
} from "../../hooks/useFloating.ts";
