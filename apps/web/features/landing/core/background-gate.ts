/**
 * background-gate.ts — whether the hero background may follow the pointer, as one pure decision.
 *
 * `LandingBackground` reads the environment into a {@link BackgroundSnapshot} (media queries, the
 * app's `data-motion` overlay, the navigator's hints, whether the hero is on screen) and asks
 * {@link decideBackground} what to do with it. Nothing here touches the DOM, so every row of the
 * gate table is a unit test (`background-gate.test.ts`).
 *
 * The background is the B7 spotlight grid and the B10 grain (`flows/LANDING.md` §3.6; Decision
 * #288 retired the B1 constellation and the B9 ring). Two modes:
 * - `spotlight` — the B7 spotlight follows a fine pointer: one pointer read per animation frame,
 *   written as two custom properties on the background.
 * - `static` — the SSR paint and nothing else: grid, grain and the spotlight at its SSR position.
 *
 * `pause` says why a `spotlight` background is held still right now; it never applies to `static`,
 * which has nothing to hold.
 */

// #region Contract
/** The background path the hero paints. */
export type BackgroundMode = "static" | "spotlight";

/** The Dev Context Switcher's `landingBackground` choice; `auto` everywhere outside development. */
export type BackgroundForce = "auto" | "static" | "spotlight";

/** Why the hero is not following the pointer, reflected as `data-lp-bg-reason` on `.lp-root`. */
export type BackgroundReason =
	| "forced-static"
	| "forced-colors"
	| "reduced-motion"
	| "coarse-pointer"
	| "save-data"
	| "low-memory"
	| "low-cpu";

/** Why a following spotlight is held still. */
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
	/** `(hover: hover) and (pointer: fine)` matches — a mouse or trackpad. */
	finePointer: boolean;
	/** `(forced-colors: active)` matches; the stylesheet hides every background layer then. */
	forcedColors: boolean;
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
	/** Why the mode is `static`; `null` when the spotlight follows the pointer. */
	reason: BackgroundReason | null;
	/** Why a following spotlight is held still; always `null` for `static`. */
	pause: BackgroundPause | null;
}

/** Devices reporting less memory than this (GiB) keep the still spotlight. */
export const BACKGROUND_MIN_MEMORY_GB = 4;

/** Devices reporting this many logical cores or fewer keep the still spotlight. */
export const BACKGROUND_MAX_LOW_CORES = 4;
// #endregion

// #region Gate
function known(value: number | null): value is number {
	return value !== null && Number.isFinite(value) && value > 0;
}

/** The device gates the spotlight must pass under `auto`, in a fixed order so the reason is stable. */
function deviceReason(s: BackgroundSnapshot): BackgroundReason | null {
	if (!s.finePointer) return "coarse-pointer";
	if (s.saveData) return "save-data";
	if (known(s.deviceMemory) && s.deviceMemory < BACKGROUND_MIN_MEMORY_GB) return "low-memory";
	if (known(s.hardwareConcurrency) && s.hardwareConcurrency <= BACKGROUND_MAX_LOW_CORES) {
		return "low-cpu";
	}
	return null;
}

/**
 * Decide the hero background. The order is fixed: a forced `static`, forced colours and reduced
 * motion (either channel) keep the SSR paint whatever else is true; under `auto` the device gates
 * follow — a fine pointer, then Save-Data, memory (unknown memory passes) and cores — and a forced
 * `spotlight` skips exactly those. A hidden tab or an offscreen hero never changes the mode, only the
 * pause.
 */
export function decideBackground(s: BackgroundSnapshot): BackgroundVerdict {
	if (s.force === "static") return { mode: "static", reason: "forced-static", pause: null };
	if (s.forcedColors) return { mode: "static", reason: "forced-colors", pause: null };
	if (s.reducedMotionMedia || s.dataMotionReduced) {
		return { mode: "static", reason: "reduced-motion", pause: null };
	}
	const blocked = s.force === "spotlight" ? null : deviceReason(s);
	if (blocked !== null) return { mode: "static", reason: blocked, pause: null };
	const pause: BackgroundPause | null = s.hidden ? "hidden" : s.intersecting ? null : "offscreen";
	return { mode: "spotlight", reason: null, pause };
}

/** Read a raw `landingBackground` value (a `data-dev-*` attribute) as a {@link BackgroundForce}. */
export function parseBackgroundForce(raw: string | null | undefined): BackgroundForce {
	return raw === "static" || raw === "spotlight" ? raw : "auto";
}
// #endregion
