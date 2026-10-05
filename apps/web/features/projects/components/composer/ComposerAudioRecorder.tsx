import type { JSX, RefObject } from "preact";
import type { ReadonlySignal } from "@preact/signals";
import { useEffect, useRef } from "preact/hooks";
import { formatClock, formatDuration } from "../../core/composer-model.ts";
import type { AudioRecorderApi } from "../../hooks/useAudioRecorder.ts";
import type { RecorderPhase } from "../../types/composer-types.ts";

// #region Constants + status
/** A press held at least this long is a hold-to-talk gesture; shorter is a click-to-latch. */
const HOLD_THRESHOLD_MS = 350;

/** The one sentence announced on each capture phase transition (see the `role="status"` line). */
export function voiceStatus(phase: RecorderPhase, durationMs: number): string {
	switch (phase) {
		case "requesting":
			return "Connecting to your microphone.";
		case "recording":
			return "Recording.";
		case "paused":
			return "Recording paused.";
		case "recorded":
			return `Recording ready, ${formatDuration(durationMs)}. Send or discard it.`;
		default:
			return "";
	}
}
// #endregion

// #region Voice gestures (click-to-toggle · hold-to-talk · Ctrl+Space)
/** The pointer handlers {@link useVoiceGestures} hands to the mic control. */
export interface VoiceGestureHandlers {
	/** Starts a take, or stops a latched one. */
	onMicPointerDown: (event: JSX.TargetedPointerEvent<HTMLButtonElement>) => void;
	/** Ends a hold-to-talk take on release; a quick click leaves it latched. */
	onMicPointerUp: () => void;
	/** Ends a held take when the pointer is cancelled. */
	onMicPointerCancel: () => void;
}

/**
 * The composer's voice gestures over a shared {@link AudioRecorderApi}: click-to-toggle and
 * hold-to-talk on the mic control, plus a global `Ctrl+Space` held-shortcut that records while the
 * field is empty and stops on release.
 */
export function useVoiceGestures(
	rec: AudioRecorderApi,
	text: ReadonlySignal<string>,
): VoiceGestureHandlers {
	const pressAtRef = useRef(0);
	const holdingRef = useRef(false);
	const shortcutRef = useRef(false);
	const hasText = text.value.trim().length > 0;

	useEffect(() => {
		function onKeyDown(event: KeyboardEvent): void {
			if (!event.ctrlKey || event.code !== "Space" || event.repeat) return;
			if (text.value.trim().length > 0 || rec.phase.value !== "inactive") return;
			event.preventDefault();
			shortcutRef.current = true;
			void rec.start();
		}
		function onKeyUp(event: KeyboardEvent): void {
			if (!shortcutRef.current) return;
			if (event.code === "Space" || event.key === "Control") {
				shortcutRef.current = false;
				if (rec.phase.value === "recording") rec.stop();
			}
		}
		globalThis.addEventListener("keydown", onKeyDown);
		globalThis.addEventListener("keyup", onKeyUp);
		return () => {
			globalThis.removeEventListener("keydown", onKeyDown);
			globalThis.removeEventListener("keyup", onKeyUp);
		};
	}, []);

	function onMicPointerDown(event: JSX.TargetedPointerEvent<HTMLButtonElement>): void {
		if (event.button !== 0) return;
		if (rec.phase.value === "recording") {
			rec.stop();
			return;
		}
		if (rec.phase.value !== "inactive" || hasText) return;
		holdingRef.current = true;
		pressAtRef.current = performance.now();
		try {
			// Capture keeps a drag off the button still counting as a hold. It throws if the pointer is
			// already gone — which must not cost the viewer the recording they just asked for.
			event.currentTarget.setPointerCapture?.(event.pointerId);
		} catch { /* pointer released before the handler ran — carry on */ }
		void rec.start();
	}
	function onMicPointerUp(): void {
		if (!holdingRef.current) return;
		holdingRef.current = false;
		const held = performance.now() - pressAtRef.current;
		// A real hold ends the take on release; a quick click leaves it latched (click again to stop).
		if (held >= HOLD_THRESHOLD_MS && rec.phase.value === "recording") rec.stop();
	}
	function onMicPointerCancel(): void {
		if (!holdingRef.current) return;
		holdingRef.current = false;
		if (rec.phase.value === "recording") rec.stop();
	}

	return { onMicPointerDown, onMicPointerUp, onMicPointerCancel };
}
// #endregion

// #region Voice field
/** Props for {@link ComposerAudioRecorder}. */
export interface ComposerAudioRecorderProps {
	/** The composer's recorder. */
	rec: AudioRecorderApi;
	/** The waveform canvas the composer's `useWaveform` paints into. */
	canvasRef: RefObject<HTMLCanvasElement>;
}

/**
 * The voice memo occupying the field while a take is requested, running, paused or finished: a
 * connecting hint, the live (or static) waveform canvas, and a `mm:ss` clock with its ceiling.
 */
export function ComposerAudioRecorder({ rec, canvasRef }: ComposerAudioRecorderProps): JSX.Element {
	const phase = rec.phase.value;
	const memo = rec.draft.value;
	return (
		<div class="chat-composer__voice" data-phase={phase}>
			{phase === "requesting" && (
				<span class="chat-composer__connecting">Connecting to your microphone…</span>
			)}
			<canvas
				ref={canvasRef}
				class="chat-composer__wave"
				data-phase={phase}
				aria-hidden="true"
			/>
			{
				/* Readable on demand, but never a live region — a clock announcing itself five
				    times a second would bury every other message. Transitions are announced by
				    the status line instead. */
			}
			<span class="chat-composer__timer">
				{formatClock(
					phase === "recorded" && memo ? memo.durationMs : rec.elapsedMs.value,
				)}
				{phase !== "recorded" && (
					<span class="chat-composer__timer-max">/ {formatClock(rec.maxMs)}</span>
				)}
			</span>
		</div>
	);
}
// #endregion
