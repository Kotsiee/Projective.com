/**
 * @projective/ui/gantt — the DOM half of the timeline canvas: measuring it, keeping its backing store
 * honest against `devicePixelRatio`, resolving the palette through the theme bridge, and repainting
 * SYNCHRONOUSLY.
 *
 * NO FRAME IS EVER REQUIRED. The draw runs in `useLayoutEffect`, which Preact flushes synchronously
 * during commit — so a scroll signal write → render → paint completes with no `requestAnimationFrame`
 * in the path. That is not a performance choice: rAF, CSS transitions and CSS animations are all
 * frozen in a hidden or background tab, and a grid whose lines needed a frame would simply be blank
 * there. (`useEffect` would NOT do — Preact defers it behind a rAF racing a timeout.)
 *
 * THE PALETTE IS RE-READ when a theme attribute moves anywhere on the probe's ancestor chain (the
 * app writes `<html>`, a portable consumer may theme a `.ds-scope` subtree), when the colour scheme
 * media query flips, and when the ACCENT SET changes — which is a property of the data: a timeline
 * with no overdue item renders no `--danger` swatch, so the first overdue item would otherwise be
 * painted with the fallback until the theme happened to move.
 */
import type { RefObject } from "preact";
import { useCallback, useEffect, useLayoutEffect, useRef } from "preact/hooks";
import type { GanttScene, PaintReport } from "../core/gantt-paint.ts";
import { paintGantt } from "../core/gantt-paint.ts";
import type { GanttPalette } from "../core/theme-bridge.ts";
import { readGanttPalette } from "../core/theme-bridge.ts";

// #region Types
export interface UseGanttCanvasOptions {
	canvasRef: RefObject<HTMLCanvasElement>;
	/** The hidden swatch subtree the palette is resolved from (`GanttProbe` renders it). */
	probeRef: RefObject<HTMLElement>;
	/** The scene for the NEXT draw. Re-read on every draw, so it must be cheap and side-effect free. */
	scene: () => GanttScene;
	/** A stable key for the accent set the probe currently renders swatches for. */
	accentKey: () => string;
	/** Called whenever the palette is (re)resolved — the store adopts the row-height token from it. */
	onPalette?: (palette: GanttPalette) => void;
	/** Called after each painted frame with what it reported (truncated labels, shape counts). */
	onReport?: (report: PaintReport) => void;
}

export interface GanttCanvasApi {
	/** Re-measure and repaint synchronously — a complete, final frame on return. */
	redraw: () => void;
	/** The palette resolved for the last draw, or null before the first. */
	palette: () => GanttPalette | null;
	/** What the last draw reported, or null before the first. */
	report: () => PaintReport | null;
}
// #endregion

export function useGanttCanvas(opts: UseGanttCanvasOptions): GanttCanvasApi {
	const { canvasRef, probeRef } = opts;
	const paletteRef = useRef<GanttPalette | null>(null);
	const reportRef = useRef<PaintReport | null>(null);
	const accentKeyRef = useRef("");
	// Written during render so a draw triggered OUTSIDE the render cycle — a ResizeObserver, a theme
	// mutation — paints the scene belonging to the latest render rather than a captured stale one.
	const sceneRef = useRef(opts.scene);
	sceneRef.current = opts.scene;
	const accentRef = useRef(opts.accentKey);
	accentRef.current = opts.accentKey;
	const onPaletteRef = useRef(opts.onPalette);
	onPaletteRef.current = opts.onPalette;
	const onReportRef = useRef(opts.onReport);
	onReportRef.current = opts.onReport;

	const draw = useCallback(() => {
		const canvas = canvasRef.current;
		const probe = probeRef.current;
		if (!canvas || !probe) return;
		// Reads first, writes after: interleaving them turns a cheap measurement into a forced
		// synchronous layout on every frame.
		const rect = canvas.getBoundingClientRect();
		const rtl = getComputedStyle(canvas).direction === "rtl";
		if (rect.width <= 0 || rect.height <= 0) return;

		const dpr = Math.max(1, globalThis.devicePixelRatio || 1);
		const backingW = Math.max(1, Math.round(rect.width * dpr));
		const backingH = Math.max(1, Math.round(rect.height * dpr));
		// Assigning either dimension re-creates and clears the backing store — written only on change.
		if (canvas.width !== backingW) canvas.width = backingW;
		if (canvas.height !== backingH) canvas.height = backingH;
		const ctx = canvas.getContext("2d");
		if (!ctx) return;

		const accentKey = accentRef.current();
		if (accentKey !== accentKeyRef.current) paletteRef.current = null;
		accentKeyRef.current = accentKey;
		if (!paletteRef.current) {
			paletteRef.current = readGanttPalette(probe);
			if (paletteRef.current) onPaletteRef.current?.(paletteRef.current);
		}
		const palette = paletteRef.current;
		if (!palette) {
			ctx.setTransform(1, 0, 0, 1, 0, 0);
			ctx.clearRect(0, 0, backingW, backingH);
			return;
		}
		const report = paintGantt(ctx, sceneRef.current(), palette, {
			width: rect.width,
			height: rect.height,
			dpr,
			rtl,
		});
		reportRef.current = report;
		onReportRef.current?.(report);
		// eslint-disable-next-line react-hooks/exhaustive-deps
	}, []);

	// Every render, synchronously, with no frame in the path — see the header.
	useLayoutEffect(() => {
		draw();
	});

	// #region Environment (size · theme · pixel ratio)
	useEffect(() => {
		if (typeof document === "undefined") return;
		const canvas = canvasRef.current;
		const invalidate = () => {
			paletteRef.current = null;
			draw();
		};
		const ro = typeof ResizeObserver !== "undefined" ? new ResizeObserver(() => draw()) : null;
		if (canvas) ro?.observe(canvas);

		const mo = new MutationObserver(invalidate);
		const themeAttrs = [
			"style",
			"class",
			"dir",
			"data-theme",
			"data-contrast",
			"data-cvd",
			"data-font",
		];
		for (let el: HTMLElement | null = probeRef.current; el; el = el.parentElement) {
			mo.observe(el, { attributes: true, attributeFilter: themeAttrs });
		}
		mo.observe(document.documentElement, { attributes: true, attributeFilter: themeAttrs });
		const scheme = globalThis.matchMedia?.("(prefers-color-scheme: dark)");
		scheme?.addEventListener("change", invalidate);

		// A window dragged onto a display with another pixel ratio changes nothing the observers above
		// can see; the query is rebuilt around each new ratio because it only reports the moment it
		// stops matching.
		let dprQuery: MediaQueryList | null = null;
		const onDpr = () => {
			watchDpr();
			draw();
		};
		const watchDpr = () => {
			dprQuery?.removeEventListener("change", onDpr);
			dprQuery = globalThis.matchMedia?.(`(resolution: ${globalThis.devicePixelRatio || 1}dppx)`) ??
				null;
			dprQuery?.addEventListener("change", onDpr);
		};
		watchDpr();

		return () => {
			ro?.disconnect();
			mo.disconnect();
			scheme?.removeEventListener("change", invalidate);
			dprQuery?.removeEventListener("change", onDpr);
		};
		// eslint-disable-next-line react-hooks/exhaustive-deps
	}, [draw]);
	// #endregion

	return {
		redraw: draw,
		palette: useCallback(() => paletteRef.current, []),
		report: useCallback(() => reportRef.current, []),
	};
}
