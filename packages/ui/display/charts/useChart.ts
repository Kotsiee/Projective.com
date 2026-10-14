/// <reference lib="dom" />
import type { RefObject } from "preact";
import { useEffect, useLayoutEffect, useRef } from "preact/hooks";
import { useSignal } from "@preact/signals";
import { resolveCssColor } from "../../gantt/core/theme-bridge.ts";
import {
	type ChartTier,
	chartTier,
	type ChartTierPolicy,
	DEFAULT_TIER_POLICY,
} from "./geometry.ts";

/**
 * The charts' two runtime seams: which renderer draws (SVG ↔ Canvas2D, #217(m) / §C.5) and how a
 * canvas gets its colours (the theme-bridge resolves `var()` / `color-mix()` on a probe inside the
 * figure, so a consumer's custom-property overrides and a theme change both reach the canvas).
 */

// #region Tier
const THEME_ATTRS = [
	"style",
	"class",
	"dir",
	"data-theme",
	"data-contrast",
	"data-cvd",
	"data-font",
];

/** How many consecutive SVG updates must overrun the budget before the chart escalates. */
const OVERRUNS_TO_ESCALATE = 2;

/**
 * The renderer for a chart of `entities` marks. Starts from the entity count; then, on every SVG
 * UPDATE (never the first mount, whose commit also carries the rest of the page's hydration), the
 * render-to-layout time is measured, and two consecutive overruns of the budget escalate to Canvas2D.
 * Escalation is sticky for the life of the chart.
 */
export function useChartTier(
	entities: number,
	policy: ChartTierPolicy = DEFAULT_TIER_POLICY,
): ChartTier {
	const escalated = useSignal(false);
	const overruns = useRef(0);
	const mounted = useRef(false);
	const start = typeof performance !== "undefined" ? performance.now() : 0;
	const byCount = chartTier(entities, null, policy);
	const tier: ChartTier = escalated.value ? "canvas" : byCount;

	useLayoutEffect(() => {
		if (!mounted.current) {
			mounted.current = true;
			return;
		}
		if (tier !== "svg") return;
		const elapsed = performance.now() - start;
		overruns.current = chartTier(0, elapsed, policy) === "canvas" ? overruns.current + 1 : 0;
		if (overruns.current >= OVERRUNS_TO_ESCALATE) escalated.value = true;
	});

	return tier;
}
// #endregion

// #region Canvas
/** The box a paint call draws into, in CSS pixels. */
export interface ChartBox {
	width: number;
	height: number;
	dpr: number;
	rtl: boolean;
}

/** Resolve a colour expression (`var(--ui-chart-1)`) to a canvas-ready string, cached per paint. */
export type ChartColour = (expression: string) => string;

/** Options for {@link useChartCanvas}. */
export interface UseChartCanvasOptions {
	canvasRef: RefObject<HTMLCanvasElement>;
	/** A hidden element inside the figure, so colours resolve in the chart's own theme scope. */
	probeRef: RefObject<HTMLElement>;
	/** Paint only while the canvas tier is active. */
	enabled: boolean;
	/** Draw one frame. The context is already scaled to CSS pixels and cleared. */
	paint: (ctx: CanvasRenderingContext2D, box: ChartBox, colour: ChartColour) => void;
	/** Repaint when any of these change (the data, the focused point). */
	deps: readonly unknown[];
}

/**
 * Keep a canvas painted: on mount, on resize, on a device-pixel-ratio change, on any theme attribute
 * write up the probe's ancestor chain or the document root, on a colour-scheme change, and whenever
 * `deps` change. Colours are re-resolved through the theme-bridge on every frame that follows a theme
 * change, so a recoloured theme recolours the chart.
 */
export function useChartCanvas(opts: UseChartCanvasOptions): void {
	const paintRef = useRef(opts.paint);
	paintRef.current = opts.paint;
	const cache = useRef(new Map<string, string>());
	const frame = useRef<number | null>(null);
	const drawRef = useRef<() => void>(() => {});

	drawRef.current = () => {
		frame.current = null;
		const canvas = opts.canvasRef.current;
		const probe = opts.probeRef.current;
		if (!canvas || !probe || !opts.enabled) return;
		const ctx = canvas.getContext("2d");
		if (!ctx) return;
		const rect = canvas.getBoundingClientRect();
		const dpr = globalThis.devicePixelRatio || 1;
		const width = Math.max(0, rect.width);
		const height = Math.max(0, rect.height);
		const backingW = Math.round(width * dpr);
		const backingH = Math.round(height * dpr);
		if (canvas.width !== backingW) canvas.width = backingW;
		if (canvas.height !== backingH) canvas.height = backingH;
		ctx.setTransform(1, 0, 0, 1, 0, 0);
		ctx.clearRect(0, 0, backingW, backingH);
		ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
		const colour: ChartColour = (expression) => {
			const hit = cache.current.get(expression);
			if (hit !== undefined) return hit;
			const resolved = resolveCssColor(probe, expression);
			cache.current.set(expression, resolved);
			return resolved;
		};
		const rtl = getComputedStyle(canvas).direction === "rtl";
		paintRef.current(ctx, { width, height, dpr, rtl }, colour);
	};

	const schedule = () => {
		if (frame.current !== null) return;
		frame.current = requestAnimationFrame(() => drawRef.current());
	};

	useEffect(() => {
		if (!opts.enabled) return;
		const canvas = opts.canvasRef.current;
		const onTheme = () => {
			cache.current.clear();
			schedule();
		};
		const ro = typeof ResizeObserver !== "undefined" ? new ResizeObserver(schedule) : null;
		if (canvas) ro?.observe(canvas);
		const mo = new MutationObserver(onTheme);
		for (let el: HTMLElement | null = opts.probeRef.current; el; el = el.parentElement) {
			mo.observe(el, { attributes: true, attributeFilter: THEME_ATTRS });
		}
		const scheme = globalThis.matchMedia?.("(prefers-color-scheme: dark)");
		scheme?.addEventListener("change", onTheme);
		let dprQuery: MediaQueryList | null = null;
		const watchDpr = () => {
			dprQuery?.removeEventListener("change", onDpr);
			dprQuery = globalThis.matchMedia?.(`(resolution: ${globalThis.devicePixelRatio || 1}dppx)`) ??
				null;
			dprQuery?.addEventListener("change", onDpr);
		};
		const onDpr = () => {
			watchDpr();
			schedule();
		};
		watchDpr();
		schedule();
		return () => {
			ro?.disconnect();
			mo.disconnect();
			scheme?.removeEventListener("change", onTheme);
			dprQuery?.removeEventListener("change", onDpr);
			if (frame.current !== null) cancelAnimationFrame(frame.current);
			frame.current = null;
		};
	}, [opts.enabled]);

	useEffect(() => {
		if (opts.enabled) schedule();
	}, [opts.enabled, ...opts.deps]);
}

/**
 * A `Path2D` of an SVG path drawn in a `viewW × viewH` box, mapped onto a `width × height` canvas box
 * (mirrored under RTL), so both tiers draw the very same geometry string.
 */
export function viewPath(
	d: string,
	viewW: number,
	viewH: number,
	box: ChartBox,
): Path2D {
	const out = new Path2D();
	if (!d) return out;
	const sx = box.width / viewW;
	const sy = box.height / viewH;
	const m = box.rtl
		? new DOMMatrix([-sx, 0, 0, sy, box.width, 0])
		: new DOMMatrix([sx, 0, 0, sy, 0, 0]);
	out.addPath(new Path2D(d), m);
	return out;
}

/** Whether a colour-blind overlay is on (the `data-cvd` attribute the server renders, §A.5). */
export function colourBlindActive(): boolean {
	if (typeof document === "undefined") return false;
	const cvd = document.documentElement.dataset.cvd;
	return cvd !== undefined && cvd !== "none";
}
// #endregion
