import { useSignalEffect } from "@preact/signals";
import type { RefObject } from "preact";
import { resamplePeaks } from "../core/composer-model.ts";
import type { AudioRecorderApi } from "./useAudioRecorder.ts";

/**
 * useWaveform — paint the recorder's amplitude onto a `<canvas>`, in two states:
 *
 *   - **recording** — the rolling {@link AudioRecorderApi.liveLevels} window drawn right-aligned, so
 *     new samples push in from the right and the wave auto-scrolls left in real time.
 *   - **recorded**  — the finished envelope resampled to exactly fill the canvas width, as static
 *     equal-width bars (no shorter, no longer than the input).
 *
 * Redraws are driven by `useSignalEffect` (re-runs whenever `phase`/`liveLevels`/`draft` change) — no
 * self-owned `requestAnimationFrame` loop, which also keeps it alive in the rAF-paused preview pane.
 * Bar geometry is imperative canvas drawing (not stylesheet values); the colour is read from the
 * canvas's own computed `color`, so theming stays token-driven from CSS.
 */
export function useWaveform(
	canvasRef: RefObject<HTMLCanvasElement>,
	rec: AudioRecorderApi,
): void {
	useSignalEffect(() => {
		// Subscriptions — read every reactive input so the effect re-runs on any change.
		const phase = rec.phase.value;
		const live = rec.liveLevels.value;
		const memo = rec.draft.value;

		const canvas = canvasRef.current;
		if (!canvas) return;
		const ctx = canvas.getContext("2d");
		if (!ctx) return;

		// Size the backing store to the element's CSS box × DPR (crisp on HiDPI).
		const dpr = Math.min(globalThis.devicePixelRatio || 1, 2);
		const cssW = canvas.clientWidth || 1;
		const cssH = canvas.clientHeight || 1;
		const w = Math.max(1, Math.round(cssW * dpr));
		const h = Math.max(1, Math.round(cssH * dpr));
		if (canvas.width !== w) canvas.width = w;
		if (canvas.height !== h) canvas.height = h;
		ctx.clearRect(0, 0, w, h);

		if (phase !== "recording" && phase !== "recorded") return;

		const color = globalThis.getComputedStyle(canvas).color || "#888";
		ctx.fillStyle = color;

		const barW = Math.max(2, Math.round(2 * dpr));
		const gap = Math.max(1, Math.round(2 * dpr));
		const slot = barW + gap;
		const mid = h / 2;
		const minBar = Math.max(1, Math.round(1.5 * dpr));

		const drawBars = (values: number[], count: number, alignRight: boolean) => {
			for (let i = 0; i < count; i++) {
				const value = values[i] ?? 0;
				const barH = Math.max(minBar, value * (h * 0.9));
				const x = alignRight ? w - (count - i) * slot : i * slot;
				const radius = barW / 2;
				const y = mid - barH / 2;
				// Rounded bar (fall back to a plain rect where roundRect is unavailable).
				const rr = (ctx as CanvasRenderingContext2D & {
					roundRect?: (x: number, y: number, w: number, h: number, r: number) => void;
				}).roundRect;
				ctx.beginPath();
				if (rr) {
					rr.call(ctx, x, y, barW, barH, radius);
				} else {
					ctx.rect(x, y, barW, barH);
				}
				ctx.fill();
			}
		};

		if (phase === "recording") {
			// Only as many bars as fit; newest sample hugs the right edge (scrolls left over time).
			const capacity = Math.max(1, Math.floor(w / slot));
			const window = live.length > capacity ? live.slice(-capacity) : live;
			drawBars(window, window.length, true);
		} else if (memo) {
			const count = Math.max(1, Math.floor(w / slot));
			drawBars(resamplePeaks(memo.peaks, count), count, false);
		}
	});
}
