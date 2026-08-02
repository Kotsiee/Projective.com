/**
 * composer-model — pure, DOM-free helpers + tunables for the channel Chat composer. Kept side-effect
 * free so the island, the hooks, and any future SSR seed share one source for the caps and the
 * amplitude/attachment math (root CLAUDE.md §2 — logic out of the island).
 */

import type { AttachmentKind, AudioDraft } from "../types/composer-types.ts";

// #region Tunables
/** Hard cap on staged attachments (task spec). */
export const MAX_ATTACHMENTS = 10;
/** A paste at/above this many characters collapses into a document chip instead of filling the input. */
export const PASTE_COLLAPSE_CHARS = 1000;
/** Voice-memo ceiling — recording auto-stops at five minutes. */
export const MAX_RECORDING_MS = 5 * 60 * 1000;
/**
 * Upload ceiling for a single voice memo. The duration cap is the real governor — Opus at ~32 kbps
 * puts a full five minutes near 1.2 MB and Safari's AAC near 4.8 MB — so this is the backstop for a
 * UA that picks a profligate codec, checked before the memo may leave the composer.
 */
export const MAX_AUDIO_BYTES = 10 * 1024 * 1024;
/**
 * The persisted envelope cap, mirroring `MessageAudioSchema.peaks.max(512)`. At one sample every
 * {@link PEAK_SAMPLE_MS} a five-minute take captures ~3300 peaks, so a draft envelope must always be
 * resampled down before it can satisfy the SSOT.
 */
export const MAX_AUDIO_PEAKS = 512;
/** Textarea auto-grow ceiling in px; past this it scrolls internally. */
export const TEXTAREA_MAX_H = 200;
/** Amplitude sample cadence while recording (ms) — one captured peak per tick. */
export const PEAK_SAMPLE_MS = 90;
/** How many recent peaks the live scrolling waveform keeps in view. */
export const LIVE_WAVE_WINDOW = 56;
// #endregion

// #region Extension → kind
const IMAGE_EXT = new Set([
	"png",
	"jpg",
	"jpeg",
	"gif",
	"webp",
	"avif",
	"svg",
	"bmp",
	"heic",
	"heif",
]);
const VIDEO_EXT = new Set(["mp4", "mov", "webm", "mkv", "avi", "m4v", "ogv", "3gp"]);

/** The lower-cased extension (no dot), or `""` when there is none. */
export function extOf(name: string): string {
	const dot = name.lastIndexOf(".");
	return dot > 0 ? name.slice(dot + 1).toLowerCase() : "";
}

/** Classify a file for preview: real image, video thumbnail, or a generic file glyph. */
export function fileKindOf(name: string, mime?: string): AttachmentKind {
	if (mime?.startsWith("image/")) return "image";
	if (mime?.startsWith("video/")) return "video";
	const ext = extOf(name);
	if (IMAGE_EXT.has(ext)) return "image";
	if (VIDEO_EXT.has(ext)) return "video";
	return "file";
}
// #endregion

// #region Formatting
/** `m:ss` clock for the recording timer / memo duration. */
export function formatDuration(ms: number): string {
	const total = Math.max(0, Math.round(ms / 1000));
	const m = Math.floor(total / 60);
	const s = total % 60;
	return `${m}:${s.toString().padStart(2, "0")}`;
}

/**
 * Zero-padded `mm:ss` for the live recording clock and its ceiling hint (`00:07 / 05:00`). Distinct
 * from {@link formatDuration} on purpose: a counter whose width changes as it crosses ten seconds
 * jitters the controls beside it, whereas a persisted `durationLabel` reads better unpadded.
 */
export function formatClock(ms: number): string {
	const total = Math.max(0, Math.round(ms / 1000));
	const m = Math.floor(total / 60);
	const s = total % 60;
	return `${m.toString().padStart(2, "0")}:${s.toString().padStart(2, "0")}`;
}

/** Human byte size for an attachment caption (`24 KB`, `1.4 MB`). */
export function formatBytes(bytes: number): string {
	if (bytes < 1024) return `${bytes} B`;
	const kb = bytes / 1024;
	if (kb < 1024) return `${Math.round(kb)} KB`;
	return `${(kb / 1024).toFixed(1)} MB`;
}
// #endregion

// #region Voice payload
/**
 * The file extension for a recorded container. The UA picks the codec (Opus in WebM on Chromium and
 * Firefox, AAC in MP4 on Safari), so the extension is derived from what was actually produced rather
 * than assumed — a `.webm` name on an MP4 payload breaks players that sniff by extension.
 */
export function audioExtOf(mimeType: string): string {
	const base = mimeType.split(";")[0].trim().toLowerCase();
	switch (base) {
		case "audio/webm":
			return "webm";
		case "audio/ogg":
			return "ogg";
		case "audio/mp4":
		case "audio/aac":
			return "m4a";
		case "audio/mpeg":
			return "mp3";
		case "audio/wav":
		case "audio/x-wav":
			return "wav";
		default:
			return "webm";
	}
}

/** A stable, sortable filename for a recorded memo (`voice-message-20260802-141205.webm`). */
export function voiceFileNameFor(mimeType: string, at: Date): string {
	const p = (n: number) => n.toString().padStart(2, "0");
	const stamp = `${at.getFullYear()}${p(at.getMonth() + 1)}${p(at.getDate())}` +
		`-${p(at.getHours())}${p(at.getMinutes())}${p(at.getSeconds())}`;
	return `voice-message-${stamp}.${audioExtOf(mimeType)}`;
}

/** Whether a finished memo exceeds {@link MAX_AUDIO_BYTES} and must be refused rather than uploaded. */
export function isVoiceOversize(draft: AudioDraft | null): boolean {
	return !!draft && draft.bytes > MAX_AUDIO_BYTES;
}
// #endregion

// #region Permission recovery
/**
 * Browser-specific steps for re-enabling a microphone the viewer has persistently blocked. Only ever
 * shown for a *persisted* block: once a site is blocked, pressing the mic again is silently inert, so
 * the only useful thing left to say is where the setting lives.
 *
 * Pure and UA-string-driven (rather than reading `navigator` directly) so it stays testable and SSR-safe.
 */
export function micHelpFor(ua: string): string {
	const isIos = /iPad|iPhone|iPod/.test(ua) || /FxiOS|CriOS/.test(ua);
	if (isIos) {
		return "Open the iOS Settings app → Safari → Microphone, allow access for this site, then reload this page.";
	}
	if (/Firefox|FxiOS/.test(ua)) {
		return "Select the permissions icon at the left of the address bar, clear the blocked Microphone setting, then reload this page.";
	}
	if (/Edg\//.test(ua)) {
		return "Select the lock icon at the left of the address bar → Permissions for this site → set Microphone to Allow, then reload this page.";
	}
	if (/Chrome|Chromium|CriOS/.test(ua)) {
		return "Select the icon at the left of the address bar → Site settings → set Microphone to Allow, then reload this page.";
	}
	if (/Safari/.test(ua)) {
		return "Open Safari → Settings for This Website…, set Microphone to Allow, then reload this page.";
	}
	return "Open your browser's site settings for this page, allow microphone access, then reload this page.";
}
// #endregion

// #region Waveform
/**
 * Compress a variable-length peak envelope into exactly `count` equal-width bars (bucket max), so the
 * finished memo's static bars span the full input width — no shorter, no longer. Empty input → zeros.
 */
export function resamplePeaks(peaks: number[], count: number): number[] {
	if (count <= 0) return [];
	const out = new Array<number>(count).fill(0);
	if (peaks.length === 0) return out;
	for (let i = 0; i < count; i++) {
		const start = Math.floor((i / count) * peaks.length);
		const end = Math.max(start + 1, Math.floor(((i + 1) / count) * peaks.length));
		let peak = 0;
		for (let j = start; j < end && j < peaks.length; j++) peak = Math.max(peak, peaks[j]);
		out[i] = peak;
	}
	return out;
}
// #endregion

// #region Ids
/** A stable-enough client id for a keyed draft item (attachment / pasted block). */
export function makeId(prefix = "id"): string {
	const uuid = globalThis.crypto?.randomUUID?.();
	return `${prefix}-${uuid ?? Math.random().toString(36).slice(2, 10)}`;
}
// #endregion
