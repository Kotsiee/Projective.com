/// <reference lib="dom" />

import { durationLabelOf, type VideoMetadata } from "../../types/file-types.ts";
import { describePixels, rasterToDataUrl, samplePixels } from "./image.ts";

/**
 * video — dimensions, duration and a poster frame, read out of a video file in the browser.
 *
 * The whole thing runs against an object URL over a detached `<video>` element with
 * `preload="metadata"`, so a 200 MB upload does not fetch 200 MB to answer "how wide is it" — the
 * engine reads the container header and stops, and only the seek that follows pulls a single frame.
 *
 * ## Two events that may simply never arrive
 *
 * `loadedmetadata` and `seeked` are the only signals this module has, and a codec the engine cannot
 * decode produces neither of them AND no `error` on every platform. That is what {@link waitFor}
 * exists for: an unanswered event is a timeout with a note, never a promise that stays pending and a
 * queue row that never settles.
 *
 * ## Capture is the step most likely to fail, and it fails last
 *
 * The order is deliberate — dimensions and duration are read first and kept, then the poster is
 * attempted. A DRM-protected stream refuses to render, and a cross-origin source taints the canvas so
 * `getImageData` throws; both leave a row that still knows how long the video is and how big it is,
 * with a sentence saying why there is no picture. The bytes are already safe by the time any of this
 * runs, so nothing here may fail an upload.
 */

// #region Timing
/** How long to wait for the container header. Generous: a large file on a slow disk is not a failure. */
const METADATA_TIMEOUT_MS = 8000;

/** How long to wait for a seek to land. A seek that has not completed by now is not going to. */
const SEEK_TIMEOUT_MS = 6000;

/**
 * How far into the video the poster is taken from.
 *
 * Half a second in, because frame zero of a great many videos is a black or white lead-in and a
 * placeholder derived from it describes nothing. Clamped to the midpoint so a 200 ms clip still gets
 * a frame from inside itself rather than a seek past its own end.
 */
const POSTER_OFFSET_MS = 500;
// #endregion

// #region Event plumbing
/**
 * Resolve when `event` fires, or `false` when `error` fires or the deadline passes.
 *
 * Every listener is removed on the first outcome, including the losing ones — a `seeked` handler left
 * attached to an element that has already timed out will fire later against a revoked object URL.
 */
function waitFor(element: HTMLVideoElement, event: string, timeoutMs: number): Promise<boolean> {
	return new Promise((resolve) => {
		let settled = false;
		const finish = (value: boolean) => {
			if (settled) return;
			settled = true;
			clearTimeout(timer);
			element.removeEventListener(event, onEvent);
			element.removeEventListener("error", onError);
			resolve(value);
		};
		const onEvent = () => finish(true);
		const onError = () => finish(false);
		const timer = setTimeout(() => finish(false), timeoutMs);
		element.addEventListener(event, onEvent, { once: true });
		element.addEventListener("error", onError, { once: true });
	});
}
// #endregion

// #region Entry point
/**
 * Everything readable about a video file.
 *
 * `null` means the file could not be established as a video at all — no dimensions arrived — which
 * the caller turns into a `generic` row rather than one carrying a fabricated frame size.
 *
 * `posterAtMs` reports where the frame was actually taken from and stays honest when there is no
 * frame: a poster that was never captured reports the offset that was attempted, so a later
 * re-derive knows what was already tried.
 */
export async function readVideoMetadata(
	file: File,
	notes: string[],
): Promise<VideoMetadata | null> {
	if (typeof document === "undefined" || typeof URL?.createObjectURL !== "function") {
		notes.push("Video details need a browser, so none were read.");
		return null;
	}

	const url = URL.createObjectURL(file);
	const element = document.createElement("video");
	element.preload = "metadata";
	element.muted = true;
	element.playsInline = true;
	// The source is a same-origin blob, so this taints nothing; it is set because the same element
	// path is what a remote re-derive would use, and a canvas read is the step that pays for it.
	element.crossOrigin = "anonymous";

	try {
		element.src = url;
		element.load();
		if (!await waitFor(element, "loadedmetadata", METADATA_TIMEOUT_MS)) {
			notes.push("This browser could not read the video, so its size and length are unknown.");
			return null;
		}

		const width = element.videoWidth;
		const height = element.videoHeight;
		if (!(width > 0) || !(height > 0)) {
			notes.push("The video reported no picture size, so it was not described.");
			return null;
		}

		// A live or fragmented stream reports `Infinity`, and `durationLabelOf` clamps that to `0:00`.
		// The note is what stops a reader treating a zero-length clock as a broken file.
		const rawDuration = element.duration;
		const durationMs = Number.isFinite(rawDuration) && rawDuration > 0
			? Math.round(rawDuration * 1000)
			: 0;
		if (durationMs === 0) notes.push("The video did not report a length.");

		const posterAtMs = durationMs > 0 ? Math.min(POSTER_OFFSET_MS, Math.floor(durationMs / 2)) : 0;

		let posterDataUrl: string | null = null;
		let blurhash: string | null = null;
		let colors: VideoMetadata["colors"] = null;

		// Whether assigning `currentTime` to where the element ALREADY sits fires a `seeked` at all is
		// engine-dependent — this Chromium does, in ~1ms; the specification does not require it. An
		// engine that does not would spend the entire six-second timeout inside an upload the viewer is
		// watching and then give up on a frame that was available the whole time, on every video that
		// reports no length (where the poster offset resolves to zero). So the wait is conditional on
		// the seek being a real move rather than resting on the engine being generous.
		const target = posterAtMs / 1000;
		const mustSeek = Math.abs(element.currentTime - target) > 0.01;
		if (mustSeek) element.currentTime = target;
		if (!mustSeek || await waitFor(element, "seeked", SEEK_TIMEOUT_MS)) {
			posterDataUrl = rasterToDataUrl(element, width, height);
			if (posterDataUrl === null) {
				notes.push("The poster frame could not be saved from this video.");
			}
			const sample = samplePixels(element, width, height);
			if (sample) {
				const described = describePixels(sample);
				blurhash = described.blurhash;
				colors = described.colors;
			} else {
				notes.push("The video frame could not be read, so it has no placeholder or colours.");
			}
		} else {
			notes.push("The video would not seek, so no poster frame was captured.");
		}

		return {
			kind: "video",
			width,
			height,
			aspectRatio: Math.round((width / height) * 10_000) / 10_000,
			durationMs,
			durationLabel: durationLabelOf(durationMs),
			blurhash,
			colors,
			posterAtMs,
			posterDataUrl,
		};
	} catch {
		notes.push("Reading this video was refused by the browser.");
		return null;
	} finally {
		// Order matters: dropping the source before revoking the URL stops the engine from continuing
		// to buffer against an address that no longer resolves.
		element.removeAttribute("src");
		try {
			element.load();
		} catch {
			// An element already torn down by the engine; nothing left to release.
		}
		URL.revokeObjectURL(url);
	}
}
// #endregion
