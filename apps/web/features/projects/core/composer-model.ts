/**
 * composer-model — pure, DOM-free helpers + tunables for the channel Chat composer. Kept side-effect
 * free so the island, the hooks, and any future SSR seed share one source for the caps and the
 * amplitude/attachment math (root CLAUDE.md §2 — logic out of the island).
 */

import type { AttachmentKind } from "../types/composer-types.ts";

// #region Tunables
/** Hard cap on staged attachments (task spec). */
export const MAX_ATTACHMENTS = 10;
/** A paste at/above this many characters collapses into a document chip instead of filling the input. */
export const PASTE_COLLAPSE_CHARS = 1000;
/** Voice-memo ceiling — recording auto-stops at five minutes. */
export const MAX_RECORDING_MS = 5 * 60 * 1000;
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

/** Human byte size for an attachment caption (`24 KB`, `1.4 MB`). */
export function formatBytes(bytes: number): string {
	if (bytes < 1024) return `${bytes} B`;
	const kb = bytes / 1024;
	if (kb < 1024) return `${Math.round(kb)} KB`;
	return `${(kb / 1024).toFixed(1)} MB`;
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
