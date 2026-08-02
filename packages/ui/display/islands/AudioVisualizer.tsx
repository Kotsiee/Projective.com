import type { JSX } from "preact";
import { useSignal, useSignalEffect } from "@preact/signals";
import { useRef } from "preact/hooks";
import "../styles/audio-visualizer.css";
import { cx } from "../../core/cx.ts";
import { drawWaveform, formatClock } from "../core/audio.ts";

// #region Icons (package-local — no app glyph imports)
const PlayGlyph = (
	<svg viewBox="0 0 24 24" width="1em" height="1em" aria-hidden="true" focusable="false">
		<path
			d="M8 5.5v13a1 1 0 0 0 1.53.85l10-6.5a1 1 0 0 0 0-1.7l-10-6.5A1 1 0 0 0 8 5.5Z"
			fill="currentColor"
		/>
	</svg>
);
const PauseGlyph = (
	<svg viewBox="0 0 24 24" width="1em" height="1em" aria-hidden="true" focusable="false">
		<path
			d="M7 5a1 1 0 0 1 1 1v12a1 1 0 0 1-2 0V6a1 1 0 0 1 1-1Zm10 0a1 1 0 0 1 1 1v12a1 1 0 0 1-2 0V6a1 1 0 0 1 1-1Z"
			fill="currentColor"
		/>
	</svg>
);
// #endregion

// #region Props
export interface AudioVisualizerProps {
	/** Amplitude envelope (0..1, newest last) driving the static bars. */
	peaks: number[];
	/** Total clip length in ms — sizes the simulated transport + the fallback time label. */
	durationMs: number;
	/**
	 * Audio source URL. A real URL owns a hidden `<audio>` element (real play/seek/rate + a live
	 * elapsed clock); an absent/`"#"` source falls back to a simulated timer so stubbed fixtures still
	 * exercise the full scrub/play UI.
	 */
	src?: string;
	/** Pre-formatted `m:ss` fallback shown before playback / when there is no real transport. */
	durationLabel?: string;
	/** `player` (toggle · wave · time [· speed]) or `bare` (wave only). */
	variant?: "player" | "bare";
	/** Show a playback-speed cycle button. */
	showSpeed?: boolean;
	/** Selectable playback rates cycled by the speed button (default `[1, 1.5, 2]`). */
	rates?: number[];
	/** Fired on play/pause transitions. */
	onPlay?: () => void;
	onPause?: () => void;
	/** Accessible name for the player group. */
	"aria-label"?: string;
	class?: string;
}
// #endregion

/**
 * AudioVisualizer — a reusable, token-driven voice/audio player: a play/pause toggle, a seekable
 * rounded-bar waveform (`role="slider"`), an elapsed/duration clock and an optional speed cycle. The
 * played portion tints `--wave-played` (default `--primary`) and the rest `--wave-rest` (default a
 * muted `--on-surface`); a consumer overrides those two custom properties to re-tint (e.g. an "own"
 * chat bubble). The waveform is painted imperatively via `useSignalEffect` (no self-owned rAF, so it
 * survives a paused-`requestAnimationFrame` tab).
 *
 * Transport is dual-mode: a real `src` drives a hidden `<audio>` element (true play/seek/rate + a live
 * clock); an absent/`"#"` source simulates progress over `durationMs` on a timer so stubbed assets
 * still demo the full UI. Reduced-motion is respected implicitly (bars are redrawn on discrete
 * progress ticks, not animated). ARIA: labelled group, `aria-pressed` toggle, slider with
 * `aria-valuenow` + keyboard seek.
 */
export function AudioVisualizer(props: AudioVisualizerProps): JSX.Element {
	const {
		peaks,
		durationMs,
		src,
		durationLabel,
		variant = "player",
		showSpeed = false,
		rates = [1, 1.5, 2],
		onPlay,
		onPause,
		"aria-label": ariaLabel = "Audio message",
		class: className,
	} = props;

	const hasRealSrc = !!src && src !== "#";

	const playing = useSignal(false);
	// Playback progress 0..1.
	const progress = useSignal(0);
	const rateIndex = useSignal(0);
	const canvasRef = useRef<HTMLCanvasElement>(null);
	const audioRef = useRef<HTMLAudioElement>(null);
	const timerRef = useRef<number | null>(null);
	const lastTickRef = useRef(0);

	// #region Transport
	function stopTimer(): void {
		if (timerRef.current !== null) {
			clearInterval(timerRef.current);
			timerRef.current = null;
		}
	}

	function startSimTimer(): void {
		lastTickRef.current = performance.now();
		timerRef.current = setInterval(() => {
			const now = performance.now();
			const dt = (now - lastTickRef.current) * (rates[rateIndex.value] ?? 1);
			lastTickRef.current = now;
			const next = progress.value + dt / Math.max(1, durationMs);
			if (next >= 1) {
				progress.value = 1;
				stop();
			} else {
				progress.value = next;
			}
		}, 60) as unknown as number;
	}

	function play(): void {
		if (progress.value >= 1) progress.value = 0;
		playing.value = true;
		onPlay?.();
		const el = audioRef.current;
		if (hasRealSrc && el) {
			el.playbackRate = rates[rateIndex.value] ?? 1;
			void el.play().catch(() => {});
		} else {
			startSimTimer();
		}
	}

	function stop(): void {
		playing.value = false;
		onPause?.();
		stopTimer();
		if (hasRealSrc) audioRef.current?.pause();
	}

	function toggle(): void {
		if (playing.value) stop();
		else play();
	}

	function seekToRatio(ratio: number): void {
		const clamped = Math.min(1, Math.max(0, ratio));
		progress.value = clamped;
		const el = audioRef.current;
		if (hasRealSrc && el && Number.isFinite(el.duration)) el.currentTime = clamped * el.duration;
	}

	function seekFromPointer(event: JSX.TargetedMouseEvent<HTMLCanvasElement>): void {
		const rect = event.currentTarget.getBoundingClientRect();
		seekToRatio((event.clientX - rect.left) / rect.width);
	}

	function seekFromKey(event: JSX.TargetedKeyboardEvent<HTMLCanvasElement>): void {
		if (event.key === "ArrowRight") {
			event.preventDefault();
			seekToRatio(progress.value + 0.05);
		} else if (event.key === "ArrowLeft") {
			event.preventDefault();
			seekToRatio(progress.value - 0.05);
		} else if (event.key === " " || event.key === "Enter") {
			event.preventDefault();
			toggle();
		}
	}

	function cycleRate(): void {
		rateIndex.value = (rateIndex.value + 1) % rates.length;
		const el = audioRef.current;
		if (hasRealSrc && el) el.playbackRate = rates[rateIndex.value] ?? 1;
	}
	// #endregion

	// #region Waveform paint (subscribes to progress)
	useSignalEffect(() => {
		const played = progress.value; // subscribe
		const canvas = canvasRef.current;
		if (!canvas) return;
		const style = globalThis.getComputedStyle(canvas);
		const playedColor = style.getPropertyValue("--wave-played").trim() ||
			style.getPropertyValue("--primary").trim() || "#4b6bfb";
		const restColor = style.getPropertyValue("--wave-rest").trim() ||
			style.getPropertyValue("--text-secondary").trim() || "#9aa0aa";
		drawWaveform(canvas, { peaks, progress: played, playedColor, restColor });
	});
	// #endregion

	const elapsedMs = progress.value * durationMs;
	const timeLabel = playing.value || progress.value > 0
		? formatClock(elapsedMs)
		: (durationLabel ?? formatClock(durationMs));

	const wave = (
		<canvas
			ref={canvasRef}
			class="ui-audioviz__wave"
			role="slider"
			aria-label="Seek audio"
			aria-valuemin={0}
			aria-valuemax={100}
			aria-valuenow={Math.round(progress.value * 100)}
			tabindex={0}
			onClick={seekFromPointer}
			onKeyDown={seekFromKey}
		/>
	);

	if (variant === "bare") {
		return (
			<div class={cx("ui-audioviz", "ui-audioviz--bare", className)} aria-label={ariaLabel}>
				{hasRealSrc && <audio ref={audioRef} src={src} preload="metadata" hidden />}
				{wave}
			</div>
		);
	}

	return (
		<div
			class={cx("ui-audioviz", className)}
			role="group"
			aria-label={ariaLabel}
			data-playing={playing.value ? "true" : undefined}
		>
			{hasRealSrc && (
				<audio
					ref={audioRef}
					src={src}
					preload="metadata"
					hidden
					onTimeUpdate={(e) => {
						const el = e.currentTarget;
						if (Number.isFinite(el.duration) && el.duration > 0) {
							progress.value = el.currentTime / el.duration;
						}
					}}
					onEnded={() => {
						progress.value = 1;
						stop();
					}}
				/>
			)}
			<button
				type="button"
				class="ui-audioviz__toggle"
				aria-label={playing.value ? "Pause" : "Play"}
				aria-pressed={playing.value}
				onClick={toggle}
			>
				{playing.value ? PauseGlyph : PlayGlyph}
			</button>
			{wave}
			<span class="ui-audioviz__time">{timeLabel}</span>
			{showSpeed && (
				<button
					type="button"
					class="ui-audioviz__speed"
					aria-label={`Playback speed ${rates[rateIndex.value]}×`}
					onClick={cycleRate}
				>
					{rates[rateIndex.value]}×
				</button>
			)}
		</div>
	);
}
