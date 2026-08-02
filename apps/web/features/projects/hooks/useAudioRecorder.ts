import { useEffect, useRef } from "preact/hooks";
import { useSignal } from "@preact/signals";
import type { Signal } from "@preact/signals";
import {
	LIVE_WAVE_WINDOW,
	MAX_AUDIO_BYTES,
	MAX_RECORDING_MS,
	micHelpFor,
	PEAK_SAMPLE_MS,
} from "../core/composer-model.ts";
import type {
	AudioDraft,
	MicPermission,
	RecorderError,
	RecorderPhase,
} from "../types/composer-types.ts";
import { readDevSeam } from "@web/utils/dev-seam.ts";

/**
 * useAudioRecorder — the `MediaRecorder` engine behind the composer's voice memo, capped at five
 * minutes and at {@link MAX_AUDIO_BYTES}.
 *
 * All reactive surface is signals ({@link RecorderPhase}, elapsed clock, the live amplitude window,
 * the resolved {@link MicPermission}, the finished {@link AudioDraft}, a structured
 * {@link RecorderError}); the imperative Web-Audio graph, the recorder, the media stream, and the
 * timers live in `useRef` — the external/non-reactive-DOM exception to signal-first (root CLAUDE.md
 * §Signal-first). While recording it samples the analyser on a fixed cadence, feeding both a rolling
 * window (the scrolling live wave) and a full envelope (the finished static bars).
 *
 * Four invariants the surface depends on:
 *
 *  - **The mic is only ever requested from a user gesture.** `getUserMedia` is called nowhere but
 *    {@link AudioRecorderApi.start}, which the island wires to a press.
 *  - **A pause banks time rather than measuring it.** Elapsed is accumulated per segment, so a paused
 *    recording neither advances the clock, accrues silence bars, nor counts toward the auto-stop.
 *  - **Hardware is released the moment it stops being needed.** Every exit path — stop, discard,
 *    error, unmount, `pagehide` — runs `track.stop()`, so the OS recording indicator clears
 *    immediately instead of lingering on a page the viewer has left.
 *  - **Absence of an answer is never denial.** Firefox rejects a `"microphone"` permission query, so
 *    an unavailable Permissions API leaves the state `unknown` and capture is still attempted.
 *
 * The three interaction modes (click-to-toggle, hold-to-talk, `Ctrl+Space`) all drive the same
 * start/stop pair — the island owns the gestures.
 */
export interface AudioRecorderApi {
	/** `inactive → requesting → recording ⇄ paused → recorded` (back to `inactive` on discard/error). */
	phase: Signal<RecorderPhase>;
	/** Recorded time in ms, excluding paused spans (live while recording; frozen once stopped). */
	elapsedMs: Signal<number>;
	/** The finished memo, or `null` when there is none. */
	draft: Signal<AudioDraft | null>;
	/** A structured capture failure, or `null`. */
	error: Signal<RecorderError | null>;
	/** The resolved microphone permission (`unknown` when the Permissions API cannot answer). */
	permission: Signal<MicPermission>;
	/** The most recent normalised peaks (0..1), newest last — drives the scrolling live waveform. */
	liveLevels: Signal<number[]>;
	/** The recording ceiling in ms (for the `/ 05:00` hint). */
	readonly maxMs: number;
	/** Request the mic and begin recording (no-op if already busy). */
	start: () => Promise<void>;
	/** Suspend capture, holding the encoder and the stream open. */
	pause: () => void;
	/** Resume a paused capture. */
	resume: () => void;
	/** Stop and finalise into an {@link AudioDraft}. */
	stop: () => void;
	/** Discard everything (in-flight or finished) and return to `inactive`. */
	discard: () => void;
	/** Release all OS/audio resources — call on unmount. */
	dispose: () => void;
	/** Clear the surfaced error without touching the capture state. */
	clearError: () => void;
}

// #region Capability + permission probing
/** Structural shape of the Permissions API — `"microphone"` is outside the DOM lib's `PermissionName`. */
interface PermissionStatusLike {
	state: string;
	addEventListener?: (type: string, fn: () => void) => void;
	removeEventListener?: (type: string, fn: () => void) => void;
}
interface PermissionsLike {
	query(descriptor: { name: string }): Promise<PermissionStatusLike>;
}

/** Pick the best-supported audio container, or `undefined` to let the UA choose. */
function pickMimeType(): string | undefined {
	const candidates = ["audio/webm;codecs=opus", "audio/webm", "audio/ogg;codecs=opus", "audio/mp4"];
	const supported = (globalThis as { MediaRecorder?: typeof MediaRecorder }).MediaRecorder;
	if (!supported?.isTypeSupported) return undefined;
	return candidates.find((c) => supported.isTypeSupported(c));
}

/** The user-agent string, or `""` when there is no navigator (SSR). */
function agent(): string {
	return globalThis.navigator?.userAgent ?? "";
}

/**
 * The Dev Context Switcher's simulated microphone permission, or `null` for "use the real device".
 * Reads the shipping-safe seam, so this compiles out of production along with the rest of the module's
 * dev branches — and the seam is never written there in any case.
 */
function simulatedPermission(): MicPermission | null {
	const seam = readDevSeam();
	if (!seam || seam.micPermission === "auto") return null;
	return seam.micPermission;
}
// #endregion

// #region Error construction
/** A capture failure, with recovery steps attached only where the viewer must leave the page. */
function failure(kind: RecorderError["kind"], detail?: string): RecorderError {
	switch (kind) {
		case "unsupported":
			return {
				kind,
				title: "Voice recording isn't supported in this browser.",
				detail: detail ?? "Try a current version of Chrome, Edge, Firefox, or Safari.",
			};
		case "blocked":
			return {
				kind,
				title: "Microphone access is blocked for this site.",
				detail: detail ?? "Your browser is refusing the request without asking you.",
				help: micHelpFor(agent()),
			};
		case "denied":
			return {
				kind,
				title: "Microphone access wasn't granted.",
				detail: detail ?? "Select the microphone again and choose Allow to record.",
			};
		case "no_device":
			return {
				kind,
				title: "No microphone was found.",
				detail: detail ?? "Connect a microphone or headset, then try again.",
			};
		case "device_lost":
			return { kind, title: "The microphone was disconnected.", detail };
		case "in_use":
			return {
				kind,
				title: "The microphone is in use by another app.",
				detail: detail ?? "Close whatever else is recording, then try again.",
			};
		case "too_large":
			return { kind, title: "That recording is too large to send.", detail };
		default:
			return { kind: "failed", title: "Couldn't start recording.", detail };
	}
}
// #endregion

export function useAudioRecorder(): AudioRecorderApi {
	const phase = useSignal<RecorderPhase>("inactive");
	const elapsedMs = useSignal(0);
	const draft = useSignal<AudioDraft | null>(null);
	const error = useSignal<RecorderError | null>(null);
	const permission = useSignal<MicPermission>("unknown");
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
	/** `performance.now()` at the start of the CURRENT segment; `0` while paused. */
	const segmentAtRef = useRef(0);
	/** Recorded ms banked from segments already closed by a pause. */
	const bankedRef = useRef(0);
	const envelopeRef = useRef<number[]>([]);
	/** Detach handlers for the live tracks' `ended` listeners. */
	const trackOffRef = useRef<Array<() => void>>([]);
	/** Set when capture ended because the hardware vanished, so `finalize` can say what was kept. */
	const lostRef = useRef(false);
	/** Monotonic run id — a `start()` awaited across a delay aborts if a newer run superseded it. */
	const runRef = useRef(0);
	const permStatusRef = useRef<PermissionStatusLike | null>(null);
	const permOffRef = useRef<(() => void) | null>(null);
	// #endregion

	// #region Clock
	/** Recorded time right now: banked segments plus the open one (frozen while paused). */
	function elapsedNow(): number {
		const open = segmentAtRef.current ? performance.now() - segmentAtRef.current : 0;
		return bankedRef.current + open;
	}
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
		for (const off of trackOffRef.current) off();
		trackOffRef.current = [];
		if (streamRef.current) {
			// Explicit per-track stop — this is what clears the OS/browser recording indicator.
			for (const track of streamRef.current.getTracks()) track.stop();
			streamRef.current = null;
		}
		segmentAtRef.current = 0;
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
		const durationMs = elapsedNow();
		const peaks = envelopeRef.current.slice();
		const mimeType = recorderRef.current?.mimeType || "audio/webm";
		const blob = new Blob(chunksRef.current, { type: mimeType });
		recorderRef.current = null;
		releaseCapture();
		liveLevels.value = [];
		elapsedMs.value = durationMs;

		const lost = lostRef.current;
		lostRef.current = false;

		if (blob.size === 0) {
			// Nothing captured (permission race, empty take, or the device vanished before any data).
			phase.value = "inactive";
			elapsedMs.value = 0;
			if (lost) error.value = failure("device_lost", "Nothing had been recorded yet.");
			return;
		}

		const url = URL.createObjectURL(blob);
		draft.value = { blob, url, durationMs, peaks, mimeType, bytes: blob.size };
		phase.value = "recorded";

		if (blob.size > MAX_AUDIO_BYTES) {
			// Kept and playable, but refused for upload — the island gates Send on the same check.
			error.value = failure(
				"too_large",
				`The upload limit is ${
					Math.round(MAX_AUDIO_BYTES / (1024 * 1024))
				} MB. Record a shorter memo.`,
			);
		} else if (lost) {
			error.value = failure("device_lost", "Your recording up to that point was kept.");
		}
	}
	// #endregion

	// #region Permission
	/** Resolve the current permission from the Permissions API, leaving `unknown` when it cannot answer. */
	async function probePermission(): Promise<MicPermission> {
		const perms = (globalThis.navigator as { permissions?: PermissionsLike } | undefined)
			?.permissions;
		if (!perms?.query) return permission.value;
		try {
			const status = await perms.query({ name: "microphone" });
			const read = () => {
				const state = status.state;
				if (state === "granted" || state === "denied" || state === "prompt") {
					permission.value = state;
				}
			};
			read();
			// Re-subscribe only once; the viewer may fix the setting in another tab and come back.
			if (permStatusRef.current !== status) {
				permOffRef.current?.();
				status.addEventListener?.("change", read);
				permStatusRef.current = status;
				permOffRef.current = () => status.removeEventListener?.("change", read);
			}
			return permission.value;
		} catch {
			// Firefox throws a TypeError for the "microphone" descriptor — absence is not denial.
			return permission.value;
		}
	}
	// #endregion

	// #region Sampling + device watch
	/** Start the elapsed clock and the amplitude sampler for the segment that just opened. */
	function startTimers(): void {
		clockRef.current = setInterval(() => {
			elapsedMs.value = elapsedNow();
			// Belt-and-braces device watch: some UAs drop a removed device without firing `ended`.
			const track = streamRef.current?.getAudioTracks()[0];
			if (track && track.readyState === "ended") {
				onDeviceLost();
				return;
			}
			if (elapsedMs.value >= MAX_RECORDING_MS) stop();
		}, 200) as unknown as number;

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
	}

	/** Halt the timers without touching the recorder, the stream, or the captured envelope. */
	function stopTimers(): void {
		if (clockRef.current !== null) {
			clearInterval(clockRef.current);
			clockRef.current = null;
		}
		if (sampleRef.current !== null) {
			clearInterval(sampleRef.current);
			sampleRef.current = null;
		}
	}

	/** The mic went away mid-take (unplugged headset, revoked device): keep what was captured. */
	function onDeviceLost(): void {
		if (phase.value !== "recording" && phase.value !== "paused") return;
		lostRef.current = true;
		stop();
	}
	// #endregion

	// #region Controls
	async function start(): Promise<void> {
		if (phase.value === "recording" || phase.value === "requesting" || phase.value === "paused") {
			return;
		}
		const run = ++runRef.current;
		revokeDraft();
		draft.value = null;
		error.value = null;
		envelopeRef.current = [];
		liveLevels.value = [];
		bankedRef.current = 0;
		segmentAtRef.current = 0;
		elapsedMs.value = 0;
		lostRef.current = false;
		phase.value = "requesting";

		// Dev Context Switcher simulation — reach the blocked/unsupported/slow-prompt states without
		// touching real browser settings. Compiles out of production with the seam.
		const sim = simulatedPermission();
		if (sim === "unsupported") {
			phase.value = "inactive";
			error.value = failure("unsupported");
			return;
		}
		if (sim === "denied") {
			permission.value = "denied";
			phase.value = "inactive";
			error.value = failure("blocked");
			return;
		}
		if (sim === "prompt") {
			// Hold the connecting state long enough to be seen; a granted mic otherwise resolves instantly.
			permission.value = "prompt";
			await new Promise((resolve) => setTimeout(resolve, 1200));
			if (run !== runRef.current) return;
		}

		const media = globalThis.navigator?.mediaDevices;
		const Recorder = (globalThis as { MediaRecorder?: typeof MediaRecorder }).MediaRecorder;
		if (!media?.getUserMedia || !Recorder) {
			permission.value = "unsupported";
			phase.value = "inactive";
			error.value = failure("unsupported");
			return;
		}

		// A persisted block makes the prompt inert, so say so instead of firing a request that
		// resolves nowhere. `unknown` (Firefox) always falls through to a real attempt, and a
		// simulated `granted` deliberately overrides the guard — otherwise the axis would be inert in
		// exactly the blocked browser a developer needs it in. It still asks the real device.
		if (sim !== "granted" && permission.value === "denied") {
			phase.value = "inactive";
			error.value = failure("blocked");
			return;
		}

		try {
			const stream = await media.getUserMedia({ audio: true });
			if (run !== runRef.current) {
				// Superseded while the prompt was open — release the hardware we no longer want.
				for (const track of stream.getTracks()) track.stop();
				return;
			}
			streamRef.current = stream;
			permission.value = "granted";

			// Watch for the device disappearing mid-take (unplugged headset, revoked access).
			for (const track of stream.getAudioTracks()) {
				const handler = () => onDeviceLost();
				track.addEventListener("ended", handler);
				trackOffRef.current.push(() => track.removeEventListener("ended", handler));
			}

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

			bankedRef.current = 0;
			segmentAtRef.current = performance.now();
			elapsedMs.value = 0;
			phase.value = "recording";
			startTimers();
		} catch (err) {
			phase.value = "inactive";
			releaseCapture();
			const name = (err as { name?: string })?.name ?? "";
			if (/NotFound|DevicesNotFound|OverconstrainedError/i.test(name)) {
				error.value = failure("no_device");
				return;
			}
			if (/NotReadable|TrackStart/i.test(name)) {
				error.value = failure("in_use");
				return;
			}
			if (/NotAllowed|Security|Permission/i.test(name)) {
				// A dismissed prompt is recoverable; a persisted block is not. Ask which one happened.
				const state = await probePermission();
				error.value = failure(state === "denied" ? "blocked" : "denied");
				return;
			}
			error.value = failure("failed");
		}
	}

	function pause(): void {
		const recorder = recorderRef.current;
		if (phase.value !== "recording" || !recorder || recorder.state !== "recording") return;
		try {
			recorder.pause();
		} catch { /* UA refused — fall through, the take stays live */ }
		// Bank the open segment and close it, so paused time neither ticks nor records silence.
		bankedRef.current = elapsedNow();
		segmentAtRef.current = 0;
		elapsedMs.value = bankedRef.current;
		stopTimers();
		phase.value = "paused";
	}

	function resume(): void {
		const recorder = recorderRef.current;
		if (phase.value !== "paused" || !recorder) return;
		try {
			recorder.resume();
		} catch { /* UA refused — fall through */ }
		// Some UAs suspend the graph alongside the recorder; bring it back or the wave stays flat.
		void audioCtxRef.current?.resume().catch(() => {});
		segmentAtRef.current = performance.now();
		phase.value = "recording";
		startTimers();
	}

	function stop(): void {
		const recorder = recorderRef.current;
		if (recorder && recorder.state !== "inactive") {
			recorder.stop(); // → onstop → finalize()
		} else if (phase.value === "recording" || phase.value === "paused") {
			finalize();
		}
	}

	function discard(): void {
		runRef.current++;
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
		bankedRef.current = 0;
		lostRef.current = false;
		releaseCapture();
		revokeDraft();
		draft.value = null;
		liveLevels.value = [];
		elapsedMs.value = 0;
		error.value = null;
		phase.value = "inactive";
	}

	function dispose(): void {
		runRef.current++;
		const recorder = recorderRef.current;
		if (recorder) recorder.onstop = null;
		recorderRef.current = null;
		releaseCapture();
		revokeDraft();
		permOffRef.current?.();
		permOffRef.current = null;
		permStatusRef.current = null;
	}

	function clearError(): void {
		error.value = null;
	}
	// #endregion

	// #region Lifecycle
	useEffect(() => {
		// Capability first, so an unsupported UA can be reported before the viewer presses anything.
		const media = globalThis.navigator?.mediaDevices;
		const Recorder = (globalThis as { MediaRecorder?: typeof MediaRecorder }).MediaRecorder;
		if (!media?.getUserMedia || !Recorder) {
			permission.value = "unsupported";
		} else {
			void probePermission();
		}

		// A hard navigation, a closed tab, or a bfcache eviction must release the mic immediately —
		// waiting for unmount alone would leave the OS recording indicator lit on the way out.
		const onPageHide = () => dispose();
		// Recording continues seamlessly in a background tab (a memo that silently drops audio while
		// the viewer checks a reference is data loss). Some UAs do suspend the AudioContext, which
		// only flattens the visualiser — resume it on return so the wave recovers.
		const onVisibility = () => {
			if (document.visibilityState !== "visible") return;
			if (phase.value !== "recording") return;
			void audioCtxRef.current?.resume().catch(() => {});
		};
		globalThis.addEventListener("pagehide", onPageHide);
		document.addEventListener("visibilitychange", onVisibility);
		return () => {
			globalThis.removeEventListener("pagehide", onPageHide);
			document.removeEventListener("visibilitychange", onVisibility);
			dispose();
		};
	}, []);
	// #endregion

	return {
		phase,
		elapsedMs,
		draft,
		error,
		permission,
		liveLevels,
		maxMs: MAX_RECORDING_MS,
		start,
		pause,
		resume,
		stop,
		discard,
		dispose,
		clearError,
	};
}
