/**
 * aurora-engine.ts — the pure decisions behind the wallet hero's live aurora.
 *
 * Everything here is framework-free and DOM-free so it can be unit-tested under `deno test`: whether
 * the canvas may run at all (the gate table), how its first frames are judged (the p95 sampler and
 * the stall rule), how often it draws, how large its backing store is, and the colour science that
 * keeps every piece of hero text at or above 4.5:1 whatever the shader paints beneath it.
 *
 * The DOM side (`aurora-runtime.ts`) reads the environment and the tokens, feeds them through these
 * functions, and only ever acts on their answers.
 */

// #region Modes, states and reasons
/**
 * How the hero's aurora is chosen. `auto` runs every gate and the performance watchdog; `static`
 * never mounts the canvas; `animated` skips the hardware and data-saver gates and the watchdog (so
 * the shader can be exercised on any machine) but still honours reduced motion and a hidden page.
 * Only the Dev Context Switcher can move it off `auto`.
 */
export type AuroraMode = "auto" | "static" | "animated";

/** The two ways the aurora can be painted. */
export type AuroraRendererKind = "webgl2" | "canvas2d";

/**
 * What the hero is showing, as reflected on `data-aurora`: the resting CSS gradient (`static`), a
 * live renderer, or `stopped` — a renderer that ran and was torn down by a failure, which does not
 * retry during that page view.
 */
export type AuroraState = "static" | AuroraRendererKind | "stopped";

/** Why the hero is not on the GPU path, as reflected on `data-aurora-reason`. */
export type AuroraReason =
	| "dev-static"
	| "reduced-motion"
	| "save-data"
	| "low-memory"
	| "low-cores"
	| "hidden"
	| "no-webgl"
	| "no-canvas"
	| "no-color"
	| "contrast"
	| "render-error"
	| "watchdog-p95"
	| "watchdog-stall"
	| "context-lost";

/** Why a mounted aurora is temporarily not drawing, as reflected on `data-aurora-paused`. */
export type AuroraPause = "hidden" | "offscreen";
// #endregion

// #region Gating
/** The device and document facts the gate table reads. `undefined` = the browser does not say. */
export interface AuroraEnvironment {
	/** `prefers-reduced-motion: reduce`, or the app's own `:root[data-motion="reduced"]` overlay. */
	reducedMotion: boolean;
	/** `navigator.connection.saveData`. */
	saveData: boolean | undefined;
	/** `navigator.deviceMemory`, in GiB. */
	deviceMemory: number | undefined;
	/** `navigator.hardwareConcurrency`. */
	hardwareConcurrency: number | undefined;
	/** `document.hidden`. */
	hidden: boolean;
}

/**
 * The gate table's answer: `run` (mount and draw), `wait` (do not start yet; start once the page is
 * visible again — a running aurora pauses instead) or `block` (do not mount; a running aurora is
 * removed).
 */
export type AuroraVerdict =
	| { action: "run" }
	| { action: "wait"; reason: "hidden" }
	| {
		action: "block";
		reason: "dev-static" | "reduced-motion" | "save-data" | "low-memory" | "low-cores";
	};

/** Devices reporting less memory than this (GiB) keep the static gradient under `auto`. */
export const AURORA_MIN_MEMORY_GB = 4;

/** Devices reporting this many logical cores or fewer keep the static gradient under `auto`. */
export const AURORA_MAX_LOW_CORES = 4;

function known(value: number | undefined): value is number {
	return typeof value === "number" && Number.isFinite(value) && value > 0;
}

/**
 * Decide whether the aurora may run. Gates are checked in a fixed priority so the reported reason is
 * stable: the developer's `static` choice, then reduced motion, then (under `auto` only) data saver,
 * memory and cores, and finally a hidden page, which only defers.
 */
export function decideAurora(env: AuroraEnvironment, mode: AuroraMode): AuroraVerdict {
	if (mode === "static") return { action: "block", reason: "dev-static" };
	if (env.reducedMotion) return { action: "block", reason: "reduced-motion" };
	if (mode === "auto") {
		if (env.saveData === true) return { action: "block", reason: "save-data" };
		if (known(env.deviceMemory) && env.deviceMemory < AURORA_MIN_MEMORY_GB) {
			return { action: "block", reason: "low-memory" };
		}
		if (known(env.hardwareConcurrency) && env.hardwareConcurrency <= AURORA_MAX_LOW_CORES) {
			return { action: "block", reason: "low-cores" };
		}
	}
	if (env.hidden) return { action: "wait", reason: "hidden" };
	return { action: "run" };
}
// #endregion

// #region Frame budget
/** How many rAF-to-rAF intervals the watchdog samples before judging the aurora. */
export const AURORA_SAMPLE_FRAMES = 90;

/** The 95th-percentile frame time (ms) above which the aurora is torn down. */
export const AURORA_P95_BUDGET_MS = 22;

/** Intervals discarded before sampling starts — the first link and upload of the program. */
export const AURORA_WARMUP_FRAMES = 2;

/**
 * The longest the watchdog waits, after `load`, for the page to go idle before it starts sampling
 * anyway (ms). It judges the AURORA's frames: island hydration and the first reads land right after
 * `load`, and sampling through that burst once tore a healthy canvas down on a heavier page (a 94 ms
 * hydration task inside the first 90 frames read as p95 33 ms).
 */
export const AURORA_SETTLE_TIMEOUT_MS = 2000;

/** No rAF callback for longer than this (ms) while the page is visible is a stall. */
export const AURORA_STALL_MS = 1000;

/** How often (ms) the stall timer looks at the frame clock. */
export const AURORA_STALL_TICK_MS = 250;

/**
 * Timer ticks that must have run since the last frame before a silence counts as a stall. One late
 * tick is what a long main-thread task looks like (the timer and rAF were both held up); two or more
 * ticks with no frame between them is rAF itself not firing.
 */
export const AURORA_STALL_MIN_TICKS = 2;

/** The drawing cadence: ~30 FPS. */
export const AURORA_FRAME_MS = 1000 / 30;

/**
 * Tolerance (ms) on the cadence, so a 60 Hz display whose two intervals sum to a hair under 33.3 ms
 * still draws every other frame instead of slipping to every third.
 */
export const AURORA_FRAME_SLACK_MS = 2;

/** The largest step (ms) the animation clock takes, so a resume never jumps the pattern. */
export const AURORA_MAX_STEP_MS = 100;

/**
 * Nearest-rank percentile of a sample set (`p` in 0–100). Does not mutate its input; `NaN` for an
 * empty set.
 */
export function percentile(samples: readonly number[], p: number): number {
	if (samples.length === 0) return Number.NaN;
	const sorted = [...samples].sort((a, b) => a - b);
	const rank = Math.ceil((Math.min(Math.max(p, 0), 100) / 100) * sorted.length);
	return sorted[Math.min(Math.max(rank, 1), sorted.length) - 1];
}

/** The sampler's verdict: still collecting, or settled. */
export type FrameVerdict = "sampling" | "pass" | "fail";

/**
 * Collects the first {@link AURORA_SAMPLE_FRAMES} frame intervals and settles once: `fail` when their
 * p95 exceeds the budget, `pass` otherwise. Later intervals are ignored.
 */
export class FrameSampler {
	private readonly samples: number[] = [];
	private settled: FrameVerdict = "sampling";
	private measured: number | null = null;

	constructor(
		private readonly limit: number = AURORA_SAMPLE_FRAMES,
		private readonly budgetMs: number = AURORA_P95_BUDGET_MS,
	) {}

	/** The measured p95 (ms), once settled. */
	get p95(): number | null {
		return this.measured;
	}

	/** The current verdict. */
	get verdict(): FrameVerdict {
		return this.settled;
	}

	/** Record one rAF-to-rAF interval (ms); non-finite or non-positive intervals are ignored. */
	record(intervalMs: number): FrameVerdict {
		if (this.settled !== "sampling") return this.settled;
		if (!Number.isFinite(intervalMs) || intervalMs <= 0) return this.settled;
		this.samples.push(intervalMs);
		if (this.samples.length >= this.limit) {
			this.measured = percentile(this.samples, 95);
			this.settled = this.measured > this.budgetMs ? "fail" : "pass";
		}
		return this.settled;
	}
}

/**
 * Whether the frame clock has stalled: silent for longer than `thresholdMs` across at least
 * `minTicks` timer ticks (see {@link AURORA_STALL_MIN_TICKS}).
 */
export function isFrameStalled(
	silenceMs: number,
	ticksSinceFrame: number,
	thresholdMs: number = AURORA_STALL_MS,
	minTicks: number = AURORA_STALL_MIN_TICKS,
): boolean {
	return silenceMs > thresholdMs && ticksSinceFrame >= minTicks;
}

/** Whether a frame arriving at `now` should draw, given the last drawn frame's timestamp. */
export function shouldDraw(now: number, lastDrawAt: number): boolean {
	return now - lastDrawAt >= AURORA_FRAME_MS - AURORA_FRAME_SLACK_MS;
}

/** Advance the animation clock (seconds) by a frame interval (ms), capped at {@link AURORA_MAX_STEP_MS}. */
export function advanceClock(clockSeconds: number, intervalMs: number): number {
	if (!Number.isFinite(intervalMs) || intervalMs <= 0) return clockSeconds;
	return clockSeconds + Math.min(intervalMs, AURORA_MAX_STEP_MS) / 1000;
}
// #endregion

// #region Backing-store resolution
/** A backing-store size in device-independent canvas pixels. */
export interface AuroraSize {
	width: number;
	height: number;
}

/** The GPU path's longest backing-store edge (px): soft gradients gain nothing from more. */
export const AURORA_GL_MAX_EDGE = 480;

/** The GPU path's largest backing-store scale relative to CSS pixels; device pixel ratio is ignored. */
export const AURORA_GL_MAX_SCALE = 0.5;

/** The CPU path's pixel budget — about 96 × 54, upscaled smoothly by CSS. */
export const AURORA_CPU_PIXELS = 96 * 54;

/** The smallest backing-store edge either path uses. */
export const AURORA_MIN_EDGE = 8;

/** The CPU path's largest backing-store edge, which bounds very wide or very tall heroes. */
export const AURORA_CPU_MAX_EDGE = 192;

/** The WebGL2 backing store for a hero of `cssWidth` × `cssHeight` CSS pixels. */
export function webglResolution(cssWidth: number, cssHeight: number): AuroraSize {
	const w = Math.max(cssWidth, 1);
	const h = Math.max(cssHeight, 1);
	const scale = Math.min(AURORA_GL_MAX_SCALE, AURORA_GL_MAX_EDGE / Math.max(w, h));
	return {
		width: Math.max(AURORA_MIN_EDGE, Math.round(w * scale)),
		height: Math.max(AURORA_MIN_EDGE, Math.round(h * scale)),
	};
}

/** The CPU backing store for the same hero: ~{@link AURORA_CPU_PIXELS} pixels at its aspect. */
export function cpuResolution(cssWidth: number, cssHeight: number): AuroraSize {
	const aspect = Math.max(cssWidth, 1) / Math.max(cssHeight, 1);
	const clampEdge = (n: number) =>
		Math.min(AURORA_CPU_MAX_EDGE, Math.max(AURORA_MIN_EDGE, Math.round(n)));
	const width = clampEdge(Math.sqrt(AURORA_CPU_PIXELS * aspect));
	return { width, height: clampEdge(width / aspect) };
}
// #endregion

// #region Colour
/** An sRGB colour, gamma-encoded, each channel 0–1. */
export type Rgb = readonly [number, number, number];

/** An sRGB colour with straight (non-premultiplied) alpha, every component 0–1. */
export type Rgba = readonly [number, number, number, number];

/** The WCAG 2 relative-luminance weights for linear sRGB. */
export const LUMA: Rgb = [0.2126, 0.7152, 0.0722];

/** Decode one gamma-encoded sRGB channel (0–1) to linear light. */
export function srgbToLinear(c: number): number {
	return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
}

/** Encode one linear-light channel (0–1) to gamma-encoded sRGB. */
export function linearToSrgb(c: number): number {
	const v = Math.min(Math.max(c, 0), 1);
	return v <= 0.0031308 ? v * 12.92 : 1.055 * v ** (1 / 2.4) - 0.055;
}

/** WCAG 2 relative luminance of a gamma-encoded sRGB colour. */
export function relativeLuminance(rgb: Rgb): number {
	return LUMA[0] * srgbToLinear(rgb[0]) + LUMA[1] * srgbToLinear(rgb[1]) +
		LUMA[2] * srgbToLinear(rgb[2]);
}

/** WCAG 2 contrast ratio of two relative luminances (order-independent). */
export function contrastRatio(a: number, b: number): number {
	return (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05);
}

/**
 * Source-over composite of a translucent colour onto an opaque one, in gamma-encoded sRGB — the space
 * browsers blend text and fills in.
 */
export function compositeOver(top: Rgba, bottom: Rgb): Rgb {
	const a = Math.min(Math.max(top[3], 0), 1);
	return [
		top[0] * a + bottom[0] * (1 - a),
		top[1] * a + bottom[1] * (1 - a),
		top[2] * a + bottom[2] * (1 - a),
	];
}

/**
 * Scale a linear-light colour down so its relative luminance does not exceed `ceiling`. Scaling all
 * three channels by one factor keeps the chromaticity, so the hue survives the clamp.
 */
export function clampLuminance(linear: Rgb, ceiling: number): Rgb {
	const lum = LUMA[0] * linear[0] + LUMA[1] * linear[1] + LUMA[2] * linear[2];
	if (lum <= ceiling || lum <= 0) return linear;
	const k = Math.max(ceiling, 0) / lum;
	return [linear[0] * k, linear[1] * k, linear[2] * k];
}

const NUMBER = String.raw`[+-]?(?:\d+\.?\d*|\.\d+)(?:e[+-]?\d+)?`;
const COMPONENT = new RegExp(`^(${NUMBER})(%?)$`, "i");

function component(token: string, scale: number): number | null {
	if (token.toLowerCase() === "none") return 0;
	const m = COMPONENT.exec(token);
	if (!m) return null;
	const value = Number(m[1]);
	if (!Number.isFinite(value)) return null;
	return Math.min(Math.max(m[2] ? value / 100 : value / scale, 0), 1);
}

function splitArgs(body: string): { channels: string[]; alpha: string | null } | null {
	const slash = body.split("/");
	if (slash.length > 2) return null;
	const head = slash[0].trim();
	const channels = head.includes(",")
		? head.split(",").map((s) => s.trim())
		: head.split(/\s+/).filter(Boolean);
	let alpha = slash.length === 2 ? slash[1].trim() : null;
	if (alpha === null && channels.length === 4 && head.includes(",")) alpha = channels.pop()!;
	return { channels, alpha };
}

/**
 * Parse the colour syntaxes a computed `color` value comes back in — `rgb()`/`rgba()` in either the
 * comma or the space form, `color(srgb …)` / `color(srgb-linear …)` with 0–1 or percentage
 * components, and `transparent`. Anything else (`oklab()`, `lab()`, `color(display-p3 …)`, …) returns
 * `null`, and the caller normalises it by painting it into a canvas instead.
 */
export function parseCssColor(value: string): Rgba | null {
	const v = value.trim().toLowerCase();
	if (v === "transparent") return [0, 0, 0, 0];
	const fn = /^(rgba?|color)\((.*)\)$/.exec(v);
	if (!fn) return null;
	let body = fn[2].trim();
	let space: "srgb" | "srgb-linear" | null = null;
	if (fn[1] === "color") {
		const m = /^(srgb-linear|srgb)\s+(.*)$/.exec(body);
		if (!m) return null;
		space = m[1] as "srgb" | "srgb-linear";
		body = m[2];
	}
	const args = splitArgs(body);
	if (!args || args.channels.length !== 3) return null;
	const scale = space ? 1 : 255;
	const rgb = args.channels.map((c) => component(c, scale));
	const alpha = args.alpha === null ? 1 : component(args.alpha, 1);
	if (rgb.some((c) => c === null) || alpha === null) return null;
	let [r, g, b] = rgb as number[];
	if (space === "srgb-linear") [r, g, b] = [linearToSrgb(r), linearToSrgb(g), linearToSrgb(b)];
	return [r, g, b, alpha];
}
// #endregion

// #region Contrast ceiling
/** One text treatment over the hero: an ink, optionally over a translucent veil (a glass fill). */
export interface InkPair {
	ink: Rgba;
	veil?: Rgba;
}

/** The contrast every piece of hero text must keep. */
export const AURORA_CONTRAST_TARGET = 4.5;

/**
 * Headroom solved on top of the target, so 8-bit quantisation, the dither and the CSS upscale of the
 * backing store can never push a pixel under 4.5:1.
 */
export const AURORA_CONTRAST_MARGIN = 0.2;

/** A ceiling below this luminance would paint a near-black hero; the static gradient is kept instead. */
export const AURORA_MIN_CEILING = 0.02;

/** Grid density of the chromaticity sweep in {@link maxGroundLuminance}. */
const SWEEP_STEPS = 6;

let sweep: Rgb[] | null = null;

/** Every chromaticity on a linear-RGB grid, scaled to unit luminance (channels may exceed 1). */
function chromaticities(): Rgb[] {
	if (sweep) return sweep;
	const out: Rgb[] = [];
	for (let r = 0; r <= SWEEP_STEPS; r++) {
		for (let g = 0; g <= SWEEP_STEPS; g++) {
			for (let b = 0; b <= SWEEP_STEPS; b++) {
				if (r + g + b === 0) continue;
				const lin: Rgb = [r / SWEEP_STEPS, g / SWEEP_STEPS, b / SWEEP_STEPS];
				const lum = LUMA[0] * lin[0] + LUMA[1] * lin[1] + LUMA[2] * lin[2];
				out.push([lin[0] / lum, lin[1] / lum, lin[2] / lum]);
			}
		}
	}
	sweep = out;
	return out;
}

/** The worst contrast any {@link InkPair} keeps over an opaque, gamma-encoded ground. */
export function worstContrast(pairs: readonly InkPair[], ground: Rgb): number {
	let worst = Infinity;
	for (const pair of pairs) {
		const under = pair.veil ? compositeOver(pair.veil, ground) : ground;
		const ink = compositeOver(pair.ink, under);
		worst = Math.min(worst, contrastRatio(relativeLuminance(ink), relativeLuminance(under)));
	}
	return worst;
}

function holdsAt(pairs: readonly InkPair[], ratio: number, lum: number): boolean {
	for (const dir of chromaticities()) {
		const lin: Rgb = [dir[0] * lum, dir[1] * lum, dir[2] * lum];
		if (lin[0] > 1 || lin[1] > 1 || lin[2] > 1) continue;
		const ground: Rgb = [linearToSrgb(lin[0]), linearToSrgb(lin[1]), linearToSrgb(lin[2])];
		if (worstContrast(pairs, ground) < ratio) return false;
	}
	return true;
}

/**
 * The highest ground relative luminance at which every ink pair keeps `ratio`, for ANY hue: the sweep
 * covers the whole sRGB gamut's chromaticities, because a translucent ink's contrast at a given ground
 * luminance depends on the ground's hue (the ink is composited over it). Inks are expected to be lighter
 * than the ground — the hero's contract — so contrast falls as the ground brightens and a binary search
 * finds the edge. Returns `0` when no ground satisfies the pairs.
 */
export function maxGroundLuminance(pairs: readonly InkPair[], ratio: number): number {
	if (pairs.length === 0) return 1;
	if (!holdsAt(pairs, ratio, 0)) return 0;
	if (holdsAt(pairs, ratio, 1)) return 1;
	let lo = 0;
	let hi = 1;
	for (let i = 0; i < 22; i++) {
		const mid = (lo + hi) / 2;
		if (holdsAt(pairs, ratio, mid)) lo = mid;
		else hi = mid;
	}
	return lo;
}

/**
 * The luminance ceiling the shader clamps to, from the hero's resolved inks: the solid ink and the
 * translucent soft ink straight on the aurora, and — when the glass fill resolves — the solid ink on a
 * resting glass control (the action pills, the scope pill, the corner tools).
 */
export function auroraCeiling(ink: Rgba, softInk: Rgba, glassFill: Rgba | null): number {
	const pairs: InkPair[] = [{ ink }, { ink: softInk }];
	if (glassFill) pairs.push({ ink, veil: glassFill });
	return maxGroundLuminance(pairs, AURORA_CONTRAST_TARGET + AURORA_CONTRAST_MARGIN);
}
// #endregion

// #region Tokens
/** The palette tokens the aurora samples, keyed by their role in the field. */
export const AURORA_PALETTE_TOKENS = {
	base: "--wlt-aurora-base",
	deep: "--wlt-aurora-indigo-deep",
	cobalt: "--wlt-aurora-cobalt",
	violet: "--wlt-aurora-violet",
	cyan: "--wlt-aurora-cyan",
} as const;

/** The ink tokens the contrast ceiling is solved from. */
export const AURORA_INK_TOKENS = {
	ink: "--wlt-hero-ink",
	soft: "--wlt-hero-ink-soft",
	glass: "--wlt-glass-fill",
} as const;

/** The aurora's five colours, gamma-encoded sRGB (alpha dropped: the palette tokens are opaque). */
export interface AuroraPalette {
	base: Rgb;
	deep: Rgb;
	cobalt: Rgb;
	violet: Rgb;
	cyan: Rgb;
}
// #endregion
