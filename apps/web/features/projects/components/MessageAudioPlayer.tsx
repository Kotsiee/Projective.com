import type { JSX } from "preact";
import { useSignal, useSignalEffect } from "@preact/signals";
import { useRef } from "preact/hooks";
import type { MessageAudio } from "../types/projects-types.ts";
import { resamplePeaks } from "../core/composer-model.ts";
import { PauseIcon, PlayIcon } from "./chat-glyphs.tsx";

/**
 * MessageAudioPlayer — playback surface for an explicit voice message (task §4). It renders the SAME
 * rounded static bar visualizer the composer's recording waveform uses (`resamplePeaks` + identical bar
 * geometry, drawn imperatively to a `<canvas>` via `useSignalEffect` — no self-owned rAF, so it also
 * survives the rAF-paused preview pane), with the PLAYED portion tinted `--primary` and the rest muted.
 *
 * Playback is stubbed while the messaging backend is behind `PROJECTS_BACKEND_LIVE` (the fixtures carry
 * no real audio URL): the transport simulates progress over `durationMs` on a timer so the scrub + play
 * states are fully exercised; the real `<audio>` element wires in behind the same gate with no markup
 * churn. Clicking the wave seeks.
 */

export interface MessageAudioPlayerProps {
	audio: MessageAudio;
	/** Right-aligned (own) vs left (other) — flips the accent origin for a subtle sent/received cue. */
	own?: boolean;
}

export function MessageAudioPlayer({ audio }: MessageAudioPlayerProps): JSX.Element {
	const playing = useSignal(false);
	// Playback progress 0..1.
	const progress = useSignal(0);
	const canvasRef = useRef<HTMLCanvasElement>(null);
	const timerRef = useRef<number | null>(null);
	const lastTickRef = useRef(0);

	// #region Transport (simulated)
	function stopTimer(): void {
		if (timerRef.current !== null) {
			clearInterval(timerRef.current);
			timerRef.current = null;
		}
	}

	function toggle(): void {
		if (playing.value) {
			playing.value = false;
			stopTimer();
			return;
		}
		if (progress.value >= 1) progress.value = 0;
		playing.value = true;
		lastTickRef.current = performance.now();
		timerRef.current = setInterval(() => {
			const now = performance.now();
			const dt = now - lastTickRef.current;
			lastTickRef.current = now;
			const next = progress.value + dt / Math.max(1, audio.durationMs);
			if (next >= 1) {
				progress.value = 1;
				playing.value = false;
				stopTimer();
			} else {
				progress.value = next;
			}
		}, 60) as unknown as number;
	}

	function seek(event: JSX.TargetedMouseEvent<HTMLCanvasElement>): void {
		const rect = event.currentTarget.getBoundingClientRect();
		const ratio = Math.min(1, Math.max(0, (event.clientX - rect.left) / rect.width));
		progress.value = ratio;
	}
	// #endregion

	// #region Canvas paint (mirrors the composer's useWaveform bar geometry)
	useSignalEffect(() => {
		const played = progress.value; // subscribe
		const canvas = canvasRef.current;
		if (!canvas) return;
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

		const style = globalThis.getComputedStyle(canvas);
		const playedColor = style.getPropertyValue("--wave-played").trim() || "#4b6bfb";
		const restColor = style.getPropertyValue("--wave-rest").trim() || "#9aa0aa";

		const barW = Math.max(2, Math.round(2 * dpr));
		const gap = Math.max(1, Math.round(2 * dpr));
		const slot = barW + gap;
		const mid = h / 2;
		const minBar = Math.max(1, Math.round(1.5 * dpr));
		const count = Math.max(1, Math.floor(w / slot));
		const values = resamplePeaks(audio.peaks, count);
		const playedBars = Math.round(played * count);

		const rr = (ctx as CanvasRenderingContext2D & {
			roundRect?: (x: number, y: number, w: number, h: number, r: number) => void;
		}).roundRect;

		for (let i = 0; i < count; i++) {
			const barH = Math.max(minBar, (values[i] ?? 0) * (h * 0.9));
			const x = i * slot;
			const y = mid - barH / 2;
			ctx.fillStyle = i < playedBars ? playedColor : restColor;
			ctx.beginPath();
			if (rr) rr.call(ctx, x, y, barW, barH, barW / 2);
			else ctx.rect(x, y, barW, barH);
			ctx.fill();
		}
	});
	// #endregion

	return (
		<div class="msg-audio" data-playing={playing.value ? "true" : undefined}>
			<button
				type="button"
				class="msg-audio__toggle"
				aria-label={playing.value ? "Pause voice message" : "Play voice message"}
				aria-pressed={playing.value}
				onClick={toggle}
			>
				{playing.value ? PauseIcon : PlayIcon}
			</button>
			<canvas
				ref={canvasRef}
				class="msg-audio__wave"
				role="slider"
				aria-label="Seek voice message"
				aria-valuemin={0}
				aria-valuemax={100}
				aria-valuenow={Math.round(progress.value * 100)}
				tabindex={0}
				onClick={seek}
			/>
			<span class="msg-audio__time">{audio.durationLabel}</span>
		</div>
	);
}
