import { resamplePeaks } from "@ui/display/core/audio.ts";

/**
 * media-peaks — the audio waveform the inspector draws when the upload stored none.
 *
 * The envelope is measured exactly as the upload pipeline measures it (`files/core/media/audio.ts`):
 * channels mixed per frame, RMS over 2048 fine buckets scaled by the composer's 2.4 gain, then
 * bucket-max compressed to 512 by the visualizer's own `resamplePeaks`, so a waveform decoded here
 * matches one stored at upload. Pure: the decode itself lives in `media-decode.ts`.
 */

// #region Envelope
/** The stored waveform resolution (`AudioMetadataSchema.peaks` caps at this). */
export const PEAK_COUNT = 512;

const ENVELOPE_BUCKETS = 2048;
const RMS_GAIN = 2.4;

/**
 * Measure decoded PCM channels as an amplitude envelope of at most {@link PEAK_COUNT} values in 0..1.
 * Channels of unequal length are read up to the shortest; no channels or no frames → `[]`.
 */
export function envelopeOf(channels: readonly ArrayLike<number>[]): number[] {
	if (channels.length === 0) return [];
	let frames = channels[0].length;
	for (const channel of channels) frames = Math.min(frames, channel.length);
	if (frames === 0) return [];

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
	return resamplePeaks(coarse, Math.min(PEAK_COUNT, buckets));
}
// #endregion

// #region Decode budget
/** The largest file the inspector downloads a second time to draw a waveform. */
export const PEAK_DECODE_MAX_BYTES = 50 * 1024 * 1024;

/** The largest decoded PCM the inspector will hold while measuring (32-bit float). */
export const PEAK_DECODE_MAX_PCM_BYTES = 384 * 1024 * 1024;

const DECODE_RATE = 44_100;
const ASSUMED_CHANNELS = 2;
const FLOAT_BYTES = 4;
const LOSSLESS = new Set(["wav", "wave", "aif", "aiff", "flac"]);
const LOSSLESS_EXPANSION = 4;
const COMPRESSED_EXPANSION = 20;

/** How the waveform is obtained: stored at upload, decoded here, or not drawn at all. */
export type PeakPlan = "stored" | "decode" | "too-large";

/** What {@link peakPlan} reads from the asset. */
export interface PeakPlanInput {
	peaks: readonly number[] | null;
	sizeBytes: number;
	durationMs: number | null;
	ext: string;
}

/**
 * The decoded PCM a file would occupy: from its duration when known (stereo float at the decode
 * rate), else from its size by a conservative expansion ratio for its codec family.
 */
export function decodedBytesEstimate(
	sizeBytes: number,
	durationMs: number | null,
	ext: string,
): number {
	if (durationMs !== null && Number.isFinite(durationMs) && durationMs > 0) {
		return (durationMs / 1000) * DECODE_RATE * ASSUMED_CHANNELS * FLOAT_BYTES;
	}
	const ratio = LOSSLESS.has(ext.toLowerCase()) ? LOSSLESS_EXPANSION : COMPRESSED_EXPANSION;
	return sizeBytes * ratio;
}

/** Whether to use the stored waveform, decode one in the browser, or draw it flat. */
export function peakPlan(input: PeakPlanInput): PeakPlan {
	if (input.peaks !== null && input.peaks.length > 0) return "stored";
	if (input.sizeBytes <= 0 || input.sizeBytes > PEAK_DECODE_MAX_BYTES) return "too-large";
	const pcm = decodedBytesEstimate(input.sizeBytes, input.durationMs, input.ext);
	return pcm <= PEAK_DECODE_MAX_PCM_BYTES ? "decode" : "too-large";
}
// #endregion
