/**
 * background-gate.ts — which hero background the landing may run, as one pure decision.
 *
 * `LandingBackground` reads the environment into a {@link BackgroundSnapshot} (media queries, the
 * app's `data-motion` overlay, the navigator's hints, what WebGL2 did when it was tried, whether the
 * hero is on screen) and asks {@link decideBackground} what to do with it. Nothing here touches the
 * DOM, so every row of the gate table is a unit test (`background-gate.test.ts`).
 *
 * Modes, from richest to plainest:
 * - `webgl` — the B1 constellation canvas (`flows/LANDING.md` §3.6). The B7 spotlight stays at its
 *   SSR position while it runs, so the background is one moving thing (§2.7).
 * - `spotlight` — the static SVG constellation with the B7 spotlight following a fine pointer.
 * - `static` — the SSR paint and nothing else: grid, grain, the SVG constellation, a still spotlight.
 *
 * `pause` says why a `webgl` or `spotlight` background is held still right now; it never applies to
 * `static`, which has nothing to hold.
 */

// #region Contract
/** The background path the hero paints. */
export type BackgroundMode = "static" | "spotlight" | "webgl";

/** The Dev Context Switcher's `landingBackground` choice; `auto` everywhere outside development. */
export type BackgroundForce = "auto" | "static" | "webgl";

/** A failure that ends the WebGL path for the rest of the page view. */
export type BackgroundFailure = "context-lost" | "watchdog" | "render-error" | "no-tokens";

/** Why the hero is not running WebGL, reflected as `data-lp-bg-reason` on `.lp-root`. */
export type BackgroundReason =
	| "forced-static"
	| "forced-colors"
	| "reduced-motion"
	| BackgroundFailure
	| "no-webgl"
	| "save-data"
	| "low-memory"
	| "unknown-memory"
	| "low-cpu";

/** Why a running background is held still. */
export type BackgroundPause = "hidden" | "offscreen";

/**
 * Everything the gate reads, as plain values. Unknown navigator hints are `null`, never guessed.
 */
export interface BackgroundSnapshot {
	/** `(prefers-reduced-motion: reduce)` matches. */
	reducedMotionMedia: boolean;
	/** `<html data-motion="reduced">` — the settings engine's in-app channel; it can flip at runtime. */
	dataMotionReduced: boolean;
	/** `navigator.connection.saveData`. */
	saveData: boolean;
	/** `navigator.deviceMemory` in GiB, or `null` where the browser does not expose it. */
	deviceMemory: number | null;
	/** `navigator.hardwareConcurrency`, or `null` where the browser does not expose it. */
	hardwareConcurrency: number | null;
	/** `(hover: hover) and (pointer: fine)` matches — a mouse or trackpad, read as "desktop". */
	finePointer: boolean;
	/** `(forced-colors: active)` matches; the stylesheet hides every background layer then. */
	forcedColors: boolean;
	/**
	 * Whether a WebGL2 context could be created: `null` until one has been tried (the try is the
	 * mount itself, so no probe context is ever thrown away), `false` once it failed.
	 */
	webgl2: boolean | null;
	/** A failure latched earlier in this page view, or `null`. */
	failure: BackgroundFailure | null;
	/** The hero intersects the viewport. */
	intersecting: boolean;
	/** `document.hidden`. */
	hidden: boolean;
	/** The developer's forced path. */
	force: BackgroundForce;
}

/** The gate's answer for one {@link BackgroundSnapshot}. */
export interface BackgroundVerdict {
	mode: BackgroundMode;
	/** Why the mode is not `webgl`; `null` when it is. */
	reason: BackgroundReason | null;
	/** Why a moving mode is held still; always `null` for `static`. */
	pause: BackgroundPause | null;
}

/** Devices reporting less memory than this (GiB) keep the static constellation. */
export const BACKGROUND_MIN_MEMORY_GB = 4;

/** Devices reporting this many logical cores or fewer keep the static constellation. */
export const BACKGROUND_MAX_LOW_CORES = 4;
// #endregion

// #region Gate
function known(value: number | null): value is number {
	return value !== null && Number.isFinite(value) && value > 0;
}

/** The capability gates WebGL must pass under `auto`, in a fixed order so the reason is stable. */
function capabilityReason(s: BackgroundSnapshot): BackgroundReason | null {
	if (s.saveData) return "save-data";
	if (known(s.deviceMemory)) {
		if (s.deviceMemory < BACKGROUND_MIN_MEMORY_GB) return "low-memory";
	} else if (!s.finePointer) {
		return "unknown-memory";
	}
	if (known(s.hardwareConcurrency) && s.hardwareConcurrency <= BACKGROUND_MAX_LOW_CORES) {
		return "low-cpu";
	}
	return null;
}

/**
 * Decide the hero background. The order is fixed: a forced `static`, forced colours and reduced
 * motion (either channel) end every moving path; a latched failure or a failed WebGL2 context ends
 * the WebGL path; under `auto` the capability gates follow (Save-Data, memory — unknown memory passes
 * only on a fine pointer — then cores), and a forced `webgl` skips exactly those. Whatever cannot run
 * WebGL falls back to the pointer spotlight on a fine pointer, otherwise to `static`. A hidden tab or
 * an offscreen hero never changes the mode, only the pause.
 */
export function decideBackground(s: BackgroundSnapshot): BackgroundVerdict {
	if (s.force === "static") return { mode: "static", reason: "forced-static", pause: null };
	if (s.forcedColors) return { mode: "static", reason: "forced-colors", pause: null };
	if (s.reducedMotionMedia || s.dataMotionReduced) {
		return { mode: "static", reason: "reduced-motion", pause: null };
	}

	const pause: BackgroundPause | null = s.hidden ? "hidden" : s.intersecting ? null : "offscreen";
	const blocked: BackgroundReason | null = s.failure ??
		(s.webgl2 === false ? "no-webgl" : s.force === "webgl" ? null : capabilityReason(s));

	if (blocked === null) return { mode: "webgl", reason: null, pause };
	if (s.finePointer) return { mode: "spotlight", reason: blocked, pause };
	return { mode: "static", reason: blocked, pause: null };
}

/** Read a raw `landingBackground` value (a `data-dev-*` attribute) as a {@link BackgroundForce}. */
export function parseBackgroundForce(raw: string | null | undefined): BackgroundForce {
	return raw === "static" || raw === "webgl" ? raw : "auto";
}
// #endregion
