/// <reference lib="dom" />
import type { ThumbOutput } from "./thumb-cache.ts";
import type { ThumbJob } from "./thumb-plan.ts";
import { canvasBlob, THUMB_PX } from "./thumb-canvas.ts";

/**
 * video-thumb — a poster for a video that has none: the frame at one second, or a tenth of the way in
 * for a clip shorter than that. The browser's own decoder does the work and reads only what it needs
 * through the proxy's `Range` support. A format this browser cannot play keeps its tile.
 */

const POSTER_SECONDS = 1;
const SHORT_CLIP_SHARE = 0.1;
const TIMEOUT_MS = 12_000;

function seekFrame(video: HTMLVideoElement, signal: AbortSignal): Promise<boolean> {
	return new Promise((resolve) => {
		const timer = setTimeout(() => finish(false), TIMEOUT_MS);
		function finish(ok: boolean): void {
			clearTimeout(timer);
			signal.removeEventListener("abort", onAbort);
			video.removeEventListener("loadedmetadata", onMetadata);
			video.removeEventListener("seeked", onSeeked);
			video.removeEventListener("error", onError);
			resolve(ok);
		}
		const onAbort = () => finish(false);
		const onError = () => finish(false);
		const onSeeked = () => finish(true);
		const onMetadata = () => {
			const duration = Number.isFinite(video.duration) ? video.duration : 0;
			video.currentTime = duration > POSTER_SECONDS ? POSTER_SECONDS : duration * SHORT_CLIP_SHARE;
		};
		signal.addEventListener("abort", onAbort, { once: true });
		video.addEventListener("loadedmetadata", onMetadata);
		video.addEventListener("seeked", onSeeked);
		video.addEventListener("error", onError);
	});
}

/** Capture a video's poster frame. */
export async function renderVideo(job: ThumbJob, signal: AbortSignal): Promise<ThumbOutput | null> {
	const video = document.createElement("video");
	video.muted = true;
	video.playsInline = true;
	video.preload = "metadata";
	video.src = job.src;
	try {
		if (!await seekFrame(video, signal) || video.videoWidth === 0) return null;
		const scale = Math.min(1, THUMB_PX / Math.max(video.videoWidth, video.videoHeight));
		const canvas = document.createElement("canvas");
		canvas.width = Math.round(video.videoWidth * scale);
		canvas.height = Math.round(video.videoHeight * scale);
		canvas.getContext("2d")?.drawImage(video, 0, 0, canvas.width, canvas.height);
		const blob = await canvasBlob(canvas);
		return blob ? { blob } : null;
	} finally {
		video.removeAttribute("src");
		video.load();
	}
}
