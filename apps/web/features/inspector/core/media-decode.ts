import { envelopeOf } from "./media-peaks.ts";

/**
 * media-decode — read an audio file's waveform in the browser when the upload stored none. Fetches
 * the bytes through the same-origin proxy, decodes them with Web Audio and measures them with
 * {@link envelopeOf}. Client-only: call it from an effect, never at module scope or during SSR.
 */

/** What decoding an audio file yields. */
export interface DecodedAudio {
	peaks: number[];
	channels: number | null;
	durationMs: number | null;
}

/**
 * Open a context purely to decode with. `OfflineAudioContext` first, because it never touches the
 * output device or waits on a gesture; a live `AudioContext` only when the offline one is refused.
 */
function openContext(): { context: BaseAudioContext; live: AudioContext | null } | null {
	if (typeof OfflineAudioContext === "function") {
		try {
			return { context: new OfflineAudioContext(1, 1, 44_100), live: null };
		} catch (err) {
			if (typeof AudioContext !== "function") throw err;
		}
	}
	if (typeof AudioContext === "function") {
		const live = new AudioContext();
		return { context: live, live };
	}
	return null;
}

/** Decode, honouring both the promise and the callback form of `decodeAudioData`. */
function decode(context: BaseAudioContext, bytes: ArrayBuffer): Promise<AudioBuffer> {
	return new Promise((resolve, reject) => {
		const returned = context.decodeAudioData(bytes, resolve, reject);
		if (returned && typeof returned.then === "function") returned.then(resolve, reject);
	});
}

/**
 * Fetch and decode `src`, returning its waveform, channel count and length. Rejects when the fetch
 * fails, is aborted, or the browser cannot decode the format; the caller draws a flat waveform.
 */
export async function decodeAudio(src: string, signal: AbortSignal): Promise<DecodedAudio> {
	const response = await fetch(src, { signal, credentials: "same-origin" });
	if (!response.ok) {
		await response.body?.cancel();
		throw new Error(`The audio could not be fetched (${response.status}).`);
	}
	const bytes = await response.arrayBuffer();
	signal.throwIfAborted();

	const opened = openContext();
	if (!opened) throw new Error("This browser cannot decode audio.");
	try {
		const decoded = await decode(opened.context, bytes);
		signal.throwIfAborted();
		const channels: Float32Array[] = [];
		for (let c = 0; c < decoded.numberOfChannels; c++) channels.push(decoded.getChannelData(c));
		return {
			peaks: envelopeOf(channels),
			channels: decoded.numberOfChannels > 0 ? decoded.numberOfChannels : null,
			durationMs: Number.isFinite(decoded.duration) && decoded.duration > 0
				? Math.round(decoded.duration * 1000)
				: null,
		};
	} finally {
		if (opened.live && opened.live.state !== "closed") await opened.live.close();
	}
}
