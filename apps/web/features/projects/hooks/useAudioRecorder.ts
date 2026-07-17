import { useRef } from "preact/hooks";
import { useSignal } from "@preact/signals";
import type { Signal } from "@preact/signals";
import { LIVE_WAVE_WINDOW, MAX_RECORDING_MS, PEAK_SAMPLE_MS } from "../core/composer-model.ts";
import type { AudioDraft, RecorderPhase } from "../types/composer-types.ts";

/**
 * useAudioRecorder — a `MediaRecorder` engine for the composer's voice memo, capped at five minutes.
 *
 * All reactive surface is signals ({@link RecorderPhase}, elapsed clock, the live amplitude window,
 * the finished {@link AudioDraft}); the imperative Web-Audio graph, the recorder, the media stream,
 * and the timers live in `useRef` — the external/non-reactive-DOM exception to signal-first
 * (root CLAUDE.md §Signal-first). While recording it samples the analyser on a fixed cadence, feeding
 * both a rolling window (the scrolling live wave) and a full envelope (the finished static bars).
 *
 * The three interaction modes (click-to-toggle, hold-to-talk, `Ctrl+Space`) all drive the same
 * {@link AudioRecorderApi.start}/{@link AudioRecorderApi.stop} pair — the island owns the gestures.
 */
export interface AudioRecorderApi {
	/** `inactive → requesting → recording → recorded` (back to `inactive` on discard/reset/error). */
	phase: Signal<RecorderPhase>;
	/** Elapsed recording time in ms (live while recording; frozen at the memo length once stopped). */
	elapsedMs: Signal<number>;
	/** The finished memo, or `null` when there is none. */
	draft: Signal<AudioDraft | null>;
	/** A human error message when capture fails (permission denied / unsupported), else `null`. */
	error: Signal<string | null>;
	/** The most recent normalised peaks (0..1), newest last — drives the scrolling live waveform. */
	liveLevels: Signal<number[]>;
	/** The recording ceiling in ms (for the "/ 5:00" hint). */
	readonly maxMs: number;
	/** Request the mic and begin recording (no-op if already busy). */
	start: () => Promise<void>;
	/** Stop and finalise into a {@link AudioDraft}. */
	stop: () => void;
	/** Discard everything (in-flight or finished) and return to `inactive`. */
	discard: () => void;
	/** Release all OS/audio resources — call on unmount. */
	dispose: () => void;
}

/** Pick the best-supported audio container, or `undefined` to let the UA choose. */
function pickMimeType(): string | undefined {
	const candidates = ["audio/webm;codecs=opus", "audio/webm", "audio/ogg;codecs=opus", "audio/mp4"];
	const supported = (globalThis as { MediaRecorder?: typeof MediaRecorder }).MediaRecorder;
	if (!supported?.isTypeSupported) return undefined;
	return candidates.find((c) => supported.isTypeSupported(c));
}

export function useAudioRecorder(): AudioRecorderApi {
	const phase = useSignal<RecorderPhase>("inactive");
	const elapsedMs = useSignal(0);
	const draft = useSignal<AudioDraft | null>(null);
	const error = useSignal<string | null>(null);
	const liveLevels = useSignal<number[]>([]);

	// #region Imperative refs (external, non-reactive DOM)
	const streamRef = useRef<MediaStream | null>(null);
	const recorderRef = useRef<MediaRecorder | null>(null);
	const chunksRef = useRef<BlobPart[]>([]);
	const audioCtxRef = useRef<AudioContext | null>(null);
	const analyserRef = useRef<AnalyserNode | null>(null);
	const frameRef = useRef<Uint8Array<ArrayBuffer> | null>(null);
	const clockRef = useRef<number | null>(null);
	const sampleRef = useRef<number | null>(null);
	const startedAtRef = useRef(0);
	const envelopeRef = useRef<number[]>([]);
	// #endregion

	// #region Teardown
	/** Stop the timers, the audio graph, and the mic tracks — but leave the captured envelope intact. */
	function releaseCapture(): void {
		if (clockRef.current !== null) {
			clearInterval(clockRef.current);
			clockRef.current = null;
		}
		if (sampleRef.current !== null) {
			clearInterval(sampleRef.current);
			sampleRef.current = null;
		}
		analyserRef.current = null;
		frameRef.current = null;
		if (audioCtxRef.current) {
			void audioCtxRef.current.close().catch(() => {});
			audioCtxRef.current = null;
		}
		if (streamRef.current) {
			for (const track of streamRef.current.getTracks()) track.stop();
			streamRef.current = null;
		}
	}

	function revokeDraft(): void {
		if (draft.value) {
			try {
				URL.revokeObjectURL(draft.value.url);
			} catch { /* already revoked — non-fatal */ }
		}
	}
	// #endregion

	// #region Finalise
	function finalize(): void {
		const durationMs = elapsedMs.value;
		const peaks = envelopeRef.current.slice();
		const type = recorderRef.current?.mimeType || "audio/webm";
		const blob = new Blob(chunksRef.current, { type });
		recorderRef.current = null;
		releaseCapture();
		liveLevels.value = [];

		if (blob.size > 0) {
			const url = URL.createObjectURL(blob);
			draft.value = { blob, url, durationMs, peaks };
			phase.value = "recorded";
		} else {
			// No audio captured (permission race / empty take) — fall back to idle.
			phase.value = "inactive";
		}
	}
	// #endregion

	// #region Controls
	async function start(): Promise<void> {
		if (phase.value === "recording" || phase.value === "requesting") return;
		revokeDraft();
		draft.value = null;
		error.value = null;
		envelopeRef.current = [];
		liveLevels.value = [];
		phase.value = "requesting";

		const media = globalThis.navigator?.mediaDevices;
		const Recorder = (globalThis as { MediaRecorder?: typeof MediaRecorder }).MediaRecorder;
		if (!media?.getUserMedia || !Recorder) {
			phase.value = "inactive";
			error.value = "Voice recording isn't supported in this browser.";
			return;
		}

		try {
			const stream = await media.getUserMedia({ audio: true });
			streamRef.current = stream;

			// Analyser graph for the live/static waveform.
			const Ctx = globalThis.AudioContext ??
				(globalThis as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
			const ctx = new Ctx();
			audioCtxRef.current = ctx;
			const source = ctx.createMediaStreamSource(stream);
			const analyser = ctx.createAnalyser();
			analyser.fftSize = 1024;
			source.connect(analyser);
			analyserRef.current = analyser;
			frameRef.current = new Uint8Array(analyser.fftSize);

			const mimeType = pickMimeType();
			const recorder = new Recorder(stream, mimeType ? { mimeType } : undefined);
			recorderRef.current = recorder;
			chunksRef.current = [];
			recorder.ondataavailable = (event) => {
				if (event.data && event.data.size > 0) chunksRef.current.push(event.data);
			};
			recorder.onstop = finalize;
			recorder.start();

			startedAtRef.current = performance.now();
			elapsedMs.value = 0;
			phase.value = "recording";

			// Clock + hard 5-minute auto-stop.
			clockRef.current = setInterval(() => {
				const ms = performance.now() - startedAtRef.current;
				elapsedMs.value = ms;
				if (ms >= MAX_RECORDING_MS) stop();
			}, 200) as unknown as number;

			// Amplitude sampling → rolling live window + full envelope.
			sampleRef.current = setInterval(() => {
				const a = analyserRef.current;
				const frame = frameRef.current;
				if (!a || !frame) return;
				a.getByteTimeDomainData(frame);
				let sum = 0;
				for (let i = 0; i < frame.length; i++) {
					const v = (frame[i] - 128) / 128;
					sum += v * v;
				}
				const level = Math.min(1, Math.sqrt(sum / frame.length) * 2.4);
				envelopeRef.current.push(level);
				const next = liveLevels.value.concat(level);
				liveLevels.value = next.length > LIVE_WAVE_WINDOW ? next.slice(-LIVE_WAVE_WINDOW) : next;
			}, PEAK_SAMPLE_MS) as unknown as number;
		} catch (err) {
			phase.value = "inactive";
			releaseCapture();
			const name = (err as { name?: string })?.name ?? "";
			error.value = /NotAllowed|Security|Permission/i.test(name)
				? "Microphone access was denied."
				: "Couldn't start recording.";
		}
	}

	function stop(): void {
		const recorder = recorderRef.current;
		if (recorder && recorder.state !== "inactive") {
			recorder.stop(); // → onstop → finalize()
		} else if (phase.value === "recording") {
			finalize();
		}
	}

	function discard(): void {
		const recorder = recorderRef.current;
		if (recorder && recorder.state !== "inactive") {
			recorder.onstop = null;
			try {
				recorder.stop();
			} catch { /* already stopped */ }
		}
		recorderRef.current = null;
		chunksRef.current = [];
		envelopeRef.current = [];
		releaseCapture();
		revokeDraft();
		draft.value = null;
		liveLevels.value = [];
		elapsedMs.value = 0;
		error.value = null;
		phase.value = "inactive";
	}

	function dispose(): void {
		const recorder = recorderRef.current;
		if (recorder) recorder.onstop = null;
		recorderRef.current = null;
		releaseCapture();
		revokeDraft();
	}
	// #endregion

	return {
		phase,
		elapsedMs,
		draft,
		error,
		liveLevels,
		maxMs: MAX_RECORDING_MS,
		start,
		stop,
		discard,
		dispose,
	};
}
