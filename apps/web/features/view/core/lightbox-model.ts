import type { LightboxMedia } from "../types/lightbox-types.ts";

/**
 * lightbox-model — the pure rules of the shared media lightbox: how the active index steps and
 * clamps, how far a click enlarges the picture, and when a horizontal swipe pages the gallery.
 */

// #region Constants
/** Clear space kept between the fitted picture and the stage's edges, in pixels. */
export const LIGHTBOX_FIT_GUTTER = 24;
/** How much a click enlarges a picture that already fills the stage. */
export const LIGHTBOX_CLICK_ZOOM = 2.5;
/** Travel past which a press becomes a drag rather than a click. */
export const LIGHTBOX_DRAG_SLOP_PX = 6;
/** Share of the stage width a swipe must travel to page the gallery. */
export const LIGHTBOX_SWIPE_RATIO = 0.18;
// #endregion

// #region Index
/** The index kept inside the gallery; `0` for an empty one. */
export function clampIndex(index: number, length: number): number {
	if (length <= 0 || !Number.isFinite(index)) return 0;
	return Math.min(Math.max(0, Math.trunc(index)), length - 1);
}

/** The index `delta` steps away, wrapping at both ends. */
export function stepIndex(index: number, delta: number, length: number): number {
	if (length <= 0) return 0;
	return (((clampIndex(index, length) + Math.trunc(delta)) % length) + length) % length;
}

/** The widest candidate of a width-described `srcset`; `null` when it names none. */
export function largestCandidate(srcset: string | null | undefined): string | null {
	if (!srcset) return null;
	let best: { url: string; width: number } | null = null;
	for (const part of srcset.split(",")) {
		const [url, descriptor] = part.trim().split(/\s+/);
		if (!url) continue;
		const width = descriptor?.endsWith("w") ? Number.parseFloat(descriptor) : 0;
		if (!best || width > best.width) best = { url, width: Number.isFinite(width) ? width : 0 };
	}
	return best?.url ?? null;
}

/** The tray's thumbnail for an item; `null` for a video with no still to show. */
export function thumbOf(media: LightboxMedia): string | null {
	if (media.thumb) return media.thumb;
	if (media.poster) return media.poster;
	return media.kind === "video" ? null : media.src;
}
// #endregion

// #region Zoom
/**
 * The scale a click enlarges to from a fitted scale: at least 100% (one image pixel per CSS pixel)
 * for a picture shrunk to fit, and {@link LIGHTBOX_CLICK_ZOOM} times the fit for one that is not.
 */
export function clickZoomTarget(fitZoom: number): number {
	const base = Number.isFinite(fitZoom) && fitZoom > 0 ? fitZoom : 1;
	return Math.max(1, base * LIGHTBOX_CLICK_ZOOM);
}

/**
 * The page a finished horizontal drag turns to: `1` (next), `-1` (previous) or `0`. A mostly
 * vertical drag never pages. In a right-to-left page, dragging left goes back.
 */
export function swipeStep(dx: number, dy: number, stageWidth: number, rtl = false): -1 | 0 | 1 {
	if (!(stageWidth > 0) || Math.abs(dx) <= Math.abs(dy)) return 0;
	if (Math.abs(dx) < stageWidth * LIGHTBOX_SWIPE_RATIO) return 0;
	const forward = dx < 0 ? 1 : -1;
	return (rtl ? -forward : forward) as -1 | 1;
}
// #endregion
