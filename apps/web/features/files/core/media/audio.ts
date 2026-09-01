/// <reference lib="dom" />

// `@ui/display/core/audio.ts` rather than the `@projective/ui/display` barrel: the barrel re-exports
// every island in the package, each of which imports its own stylesheet, and a `.css` specifier is not
// a module Deno can load — so a test that pulled the barrel in would fail on `table.css` before it ever
// reached a peak. The deep alias is the sanctioned form (root CLAUDE.md §2) and reaches the same
// function; `packages/ui/display/core/audio.ts` has no imports at all.
import { resamplePeaks } from "@ui/display/core/audio.ts";
import { type AudioMetadata, durationLabelOf } from "../../types/file-types.ts";

/**
 * audio — duration, format facts and the amplitude envelope of an audio file.
 *
 * ## Why the size bound is not squeamishness
 *
 * `decodeAudioData` has no streaming form: it takes the whole compressed buffer and returns the whole
 * decoded one, as 32-bit float PCM. A compressed megabyte at 128 kbps is about 65 seconds, and 65
 * seconds of 44.1 kHz stereo float is roughly 23 MB — so the decode costs about twenty times what the
 * file weighs. {@link DECODE_MAX_BYTES} is a bound on THAT, not on the download, and a file past it
 * gets a row saying its waveform was not read rather than a tab that stalls building one.
 *
 * ## The envelope matches the composer's, deliberately
 *
 * `useAudioRecorder` measures a voice memo as RMS scaled by 2.4 and clamped to 1, and
 * `AudioVisualizer` draws whatever it is handed. Measuring an uploaded file the same way is what
 * makes the same clip look the same whether it was recorded in the composer or dropped into the hub —
 * a peak-normalised envelope would draw a whisper and a drum kit identically, and the two waveforms
 * would disagree about the same sound.
 *
 * Compression to the stored resolution goes through the package's own `resamplePeaks`, not a second
 * bucket-max written here: `MessageAudioSchema` and `AudioMetadataSchema` both cap `peaks` at 512
 * because both feed that one visualizer, and two compressors would be two chances to disagree about
 * what a bucket is.
 */

// #region Bounds
/**
 * The largest file this will decode. See the module note — the real cost is the decoded PCM, which is
 * roughly twenty times the compressed size, so 16 MiB is about seventeen minutes at 128 kbps.
 */
const DECODE_MAX_BYTES = 16 * 1024 * 1024;

/**
 * Buckets measured before compression.
 *
 * Higher than the stored 512 on purpose: measuring straight into 512 buckets makes each one an
 * average over a long window, and a transient — the attack of a note, the start of a word — is exactly
 * what a waveform is read for. Measuring finely and then taking a bucket MAX preserves it.
 */
const ENVELOPE_BUCKETS = 2048;

/** The stored resolution. `AudioMetadataSchema.peaks` caps the array here, matching `MessageAudio`. */
const STORED_PEAKS = 512;

/** The composer's own scaling, so a memo drawn from an upload matches one drawn from a recording. */
const RMS_GAIN = 2.4;
// #endregion

// #region Decoding
/** The decode-only surface this module needs, shared by `AudioContext` and `OfflineAudioContext`. */
interface DecodeContext {
	decodeAudioData(
		buffer: ArrayBuffer,
		success?: (decoded: AudioBuffer) => void,
		failure?: (error: DOMException) => void,
	): Promise<AudioBuffer> | null;
	close?: () => Promise<void>;
}

/**
 * Open a context purely to decode with.
 *
 * `OfflineAudioContext` first: it never touches the output device, so it neither competes with audio
 * the person is already playing nor arrives suspended waiting for a gesture that will never come on a
 * page where nobody pressed play. `AudioContext` is the fallback for an engine that refuses the
 * offline constructor's parameters, and `webkitAudioContext` is reached structurally because older
 * WebKit exposes only the prefixed name.
 */
function openDecodeContext(): DecodeContext | null {
	const scope = globalThis as unknown as {
		OfflineAudioContext?: new (channels: number, length: number, rate: number) => DecodeContext;
		AudioContext?: new () => DecodeContext;
		webkitOfflineAudioContext?: new (
			channels: number,
			length: number,
			rate: number,
		) => DecodeContext;
		webkitAudioContext?: new () => DecodeContext;
	};
	const Offline = scope.OfflineAudioContext ?? scope.webkitOfflineAudioContext;
	if (Offline) {
		try {
			return new Offline(1, 1, 44100);
		} catch {
			// Some engines refuse a one-frame buffer; the live context below still decodes.
		}
	}
	const Live = scope.AudioContext ?? scope.webkitAudioContext;
	if (Live) {
		try {
			return new Live();
		} catch {
			return null;
		}
	}
	return null;
}

/**
 * Decode, tolerating both spellings of `decodeAudioData`.
 *
 * The modern form returns a promise; older WebKit returns `undefined` and answers through callbacks
 * only. Both are wired at once because `resolve` is idempotent, so whichever the engine honours wins
 * and neither path leaves the promise pending.
 */
function decode(context: DecodeContext, buffer: ArrayBuffer): Promise<AudioBuffer> {
	return new Promise((resolve, reject) => {
		let returned: Promise<AudioBuffer> | null = null;
		try {
			returned = context.decodeAudioData(buffer, resolve, reject);
		} catch (err) {
			reject(err instanceof Error ? err : new Error("The audio could not be decoded."));
			return;
		}
		if (returned && typeof returned.then === "function") returned.then(resolve, reject);
	});
}
// #endregion

// #region Envelope
/**
 * Measure `buffer` as an amplitude envelope of at most {@link STORED_PEAKS} values in 0..1.
 *
 * Channels are summed into one figure per frame before the RMS, because a stereo recording panned
 * hard left is not half as loud as the same recording centred, and a waveform drawn from channel 0
 * alone would say it was.
 */
function envelopeOf(buffer: AudioBuffer): number[] {
	const frames = buffer.length;
	if (frames === 0) return [];

	const channels: Float32Array[] = [];
	for (let c = 0; c < buffer.numberOfChannels; c++) channels.push(buffer.getChannelData(c));
	if (channels.length === 0) return [];

	const buckets = Math.max(1, Math.min(ENVELOPE_BUCKETS, frames));
	const coarse = new Array<number>(buckets);
	for (let b = 0; b < buckets; b++) {
		const start = Math.floor((b / buckets) * frames);
		const end = Math.max(start + 1, Math.floor(((b + 1) / buckets) * frames));
		let sum = 0;
		let seen = 0;
		for (let i = start; i < end && i < frames; i++) {
			let mixed = 0;
			for (const channel of channels) mixed += channel[i];
			mixed /= channels.length;
			sum += mixed * mixed;
			seen++;
		}
		const rms = seen === 0 ? 0 : Math.sqrt(sum / seen);
		coarse[b] = Math.min(1, Math.max(0, rms * RMS_GAIN));
	}
	return resamplePeaks(coarse, Math.min(STORED_PEAKS, buckets));
}
// #endregion

// #region Entry point
/**
 * Everything readable about an audio file.
 *
 * `null` means nothing could be decoded, which the caller turns into a `generic` row — a clock reading
 * `0:00` beside an empty waveform would look like a broken file rather than an unread one.
 *
 * The context is closed on every path. A live `AudioContext` left open holds a hardware audio graph
 * for the lifetime of the page, and a drop of thirty audio files would open thirty of them.
 */
export async function readAudioMetadata(
	file: File,
	notes: string[],
): Promise<AudioMetadata | null> {
	if (file.size > DECODE_MAX_BYTES) {
		notes.push("This file is too large to decode in the browser, so it has no waveform or length.");
		return null;
	}

	const context = openDecodeContext();
	if (!context) {
		notes.push("This browser cannot decode audio, so no waveform or length was read.");
		return null;
	}

	try {
		const decoded = await decode(context, await file.arrayBuffer());
		const durationMs = Number.isFinite(decoded.duration) && decoded.duration > 0
			? Math.round(decoded.duration * 1000)
			: 0;
		if (durationMs === 0) notes.push("The audio did not report a length.");

		const peaks = envelopeOf(decoded);
		if (peaks.length === 0) notes.push("The audio held no samples, so it has no waveform.");

		return {
			kind: "audio",
			durationMs,
			durationLabel: durationLabelOf(durationMs),
			peaks,
			sampleRate: decoded.sampleRate > 0 ? Math.round(decoded.sampleRate) : null,
			channels: decoded.numberOfChannels > 0 ? decoded.numberOfChannels : null,
		};
	} catch {
		notes.push("This browser could not decode the audio, so it has no waveform or length.");
		return null;
	} finally {
		try {
			await context.close?.();
		} catch {
			// An offline context has nothing to close, and a live one already torn down is fine.
		}
	}
}
// #endregion
