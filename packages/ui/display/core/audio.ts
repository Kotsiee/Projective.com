/**
 * @projective/ui/display — audio-waveform helpers (DOM-free math + one canvas paint routine).
 *
 * Shared by {@link ../islands/AudioVisualizer.tsx | AudioVisualizer}. Kept package-local (this library
 * is copy-paste-portable and must never import app code), these mirror the bar geometry the projects
 * chat composer/message players established: `resamplePeaks` (a pure bucket-max envelope compressor)
 * and `drawWaveform` (an imperative rounded-bar paint, no self-owned rAF so it survives a paused
 * `requestAnimationFrame` tab).
 */

// #region Peak resampling (pure)
/**
 * Compress a variable-length peak envelope (values 0..1) into exactly `count` equal-width bars by
 * bucket-max, so a rendered waveform spans the full input width regardless of source resolution.
 * `count <= 0` → `[]`; an empty envelope → a `count`-length run of zeros.
 */
export function resamplePeaks(peaks: number[], count: number): number[] {
	if (count <= 0) return [];
	const out = new Array<number>(count).fill(0);
	if (peaks.length === 0) return out;
	for (let i = 0; i < count; i++) {
		const start = Math.floor((i / count) * peaks.length);
		const end = Math.max(start + 1, Math.floor(((i + 1) / count) * peaks.length));
		let peak = 0;
		for (let j = start; j < end && j < peaks.length; j++) peak = Math.max(peak, peaks[j]);
		out[i] = peak;
	}
	return out;
}
// #endregion

// #region Canvas paint
/** Paint parameters for {@link drawWaveform}. */
export interface DrawWaveformOptions {
	/** Amplitude envelope (0..1), resampled to fit the canvas width. */
	peaks: number[];
	/** Playback progress 0..1 — bars before it take `playedColor`, the rest `restColor`. */
	progress: number;
	/** CSS colour for the played portion (resolved by the caller from tokens). */
	playedColor: string;
	/** CSS colour for the remaining portion. */
	restColor: string;
}

/**
 * Imperatively paint a rounded-bar waveform onto `canvas`, sizing its backing store to the CSS box ×
 * devicePixelRatio (capped at 2). Bar geometry (2·dpr bar + 2·dpr gap, 1.5·dpr floor, `h*0.9` cap,
 * `roundRect(barW/2)` with a `rect()` fallback) matches the projects message/composer players so the
 * visual language is identical everywhere. No-op without a 2D context.
 */
export function drawWaveform(canvas: HTMLCanvasElement, opts: DrawWaveformOptions): void {
	const ctx = canvas.getContext("2d");
	if (!ctx) return;

	const dpr = Math.min(globalThis.devicePixelRatio || 1, 2);
	const cssW = canvas.clientWidth || 1;
	const cssH = canvas.clientHeight || 1;
	const w = Math.max(1, Math.round(cssW * dpr));
	const h = Math.max(1, Math.round(cssH * dpr));
	if (canvas.width !== w) canvas.width = w;
	if (canvas.height !== h) canvas.height = h;
	ctx.clearRect(0, 0, w, h);

	const barW = Math.max(2, Math.round(2 * dpr));
	const gap = Math.max(1, Math.round(2 * dpr));
	const slot = barW + gap;
	const mid = h / 2;
	const minBar = Math.max(1, Math.round(1.5 * dpr));
	const count = Math.max(1, Math.floor(w / slot));
	const values = resamplePeaks(opts.peaks, count);
	const playedBars = Math.round(Math.min(1, Math.max(0, opts.progress)) * count);

	const rr = (ctx as CanvasRenderingContext2D & {
		roundRect?: (x: number, y: number, w: number, h: number, r: number) => void;
	}).roundRect;

	for (let i = 0; i < count; i++) {
		const barH = Math.max(minBar, (values[i] ?? 0) * (h * 0.9));
		const x = i * slot;
		const y = mid - barH / 2;
		ctx.fillStyle = i < playedBars ? opts.playedColor : opts.restColor;
		ctx.beginPath();
		if (rr) rr.call(ctx, x, y, barW, barH, barW / 2);
		else ctx.rect(x, y, barW, barH);
		ctx.fill();
	}
}
// #endregion

// #region Time formatting
/** Format milliseconds as `m:ss` (SSR-stable, no locale). */
export function formatClock(ms: number): string {
	const total = Math.max(0, Math.round(ms / 1000));
	const m = Math.floor(total / 60);
	const s = total % 60;
	return `${m}:${s.toString().padStart(2, "0")}`;
}
// #endregion
