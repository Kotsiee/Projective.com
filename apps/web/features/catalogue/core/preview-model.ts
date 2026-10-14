import type { PreviewDevice } from "@projective/types/catalogue";
import type { SaveState } from "./workspace-model.ts";

/**
 * preview-model — the pure rules behind the item workspace's Preview tab (plan §4.6 item 3,
 * Decision #217 (j)): how far the framed buyer simulation is scaled to fit, when it reloads, and the
 * message the two same-origin frames exchange to keep the reader's scroll position across a reload.
 */

// #region Geometry
/** A measured box, in CSS px. */
export interface Size {
	width: number;
	height: number;
}

/**
 * The desktop frame's layout width: the `--bp-xl` breakpoint (1280px), so the simulated page lays
 * out exactly as a desktop buyer's does and is then scaled down to fit the canvas.
 */
export const DESKTOP_FRAME_WIDTH = 1280;

/** The mobile frame's viewport: a 390 × 844 phone, below `--bp-sm`'s 480. */
export const MOBILE_VIEWPORT: Readonly<Size> = { width: 390, height: 844 };

/**
 * The device bezel's thickness on each side, in px. Pinned to `--cat-preview-bezel` in
 * `preview.css` (a test reads both), because the scale has to fit the whole device, bezel included.
 */
export const MOBILE_BEZEL = 12;

/** The smallest scale the preview is drawn at; below it the page is unreadable anyway. */
export const MIN_PREVIEW_SCALE = 0.2;

/** The outer size of the frame a device is drawn in, before scaling. */
export function deviceSize(device: PreviewDevice): Size {
	if (device === "mobile") {
		return {
			width: MOBILE_VIEWPORT.width + MOBILE_BEZEL * 2,
			height: MOBILE_VIEWPORT.height + MOBILE_BEZEL * 2,
		};
	}
	return { width: DESKTOP_FRAME_WIDTH, height: 0 };
}

/**
 * The scale (`--cat-preview-scale`) that fits a device's frame into the available box: never above
 * 1 (the preview is never magnified), never below {@link MIN_PREVIEW_SCALE}. The desktop frame fits
 * by width only — its height is whatever the canvas gives it — while the phone fits both ways, so the
 * whole device stays on screen. A box not yet measured (zero or not finite) is drawn at 1.
 */
export function previewScale(device: PreviewDevice, available: Size): number {
	const natural = deviceSize(device);
	const ratios: number[] = [];
	if (Number.isFinite(available.width) && available.width > 0) {
		ratios.push(available.width / natural.width);
	}
	if (natural.height > 0 && Number.isFinite(available.height) && available.height > 0) {
		ratios.push(available.height / natural.height);
	}
	if (ratios.length === 0) return 1;
	const fit = Math.min(1, ...ratios);
	return Math.round(Math.max(MIN_PREVIEW_SCALE, fit) * 10_000) / 10_000;
}
// #endregion

// #region Reload
/** How long after the last save the preview waits before reloading (successive saves restart it). */
export const PREVIEW_RELOAD_DEBOUNCE_MS = 1500;

/** Whether a save-state change means stored truth moved, so the preview should reload. */
export function savedTransition(previous: SaveState, next: SaveState): boolean {
	return previous === "saving" && next === "saved";
}
// #endregion

// #region Leaving the frame
/**
 * Whether following `href` from the framed simulation (at `current`) would load a different document.
 * Every page but the simulation itself refuses to be framed (`x-frame-options: DENY`), so such a link
 * opens in a tab of its own instead of breaking the preview; an in-page jump (`#evp-reviews`) or a
 * link back to the simulation stays in the frame.
 */
export function leavesFrame(href: string, current: URL): boolean {
	let target: URL;
	try {
		target = new URL(href, current);
	} catch {
		return false;
	}
	if (target.protocol !== "http:" && target.protocol !== "https:") return false;
	return target.origin !== current.origin || target.pathname !== current.pathname ||
		target.search !== current.search;
}
// #endregion

// #region Scroll hand-off
/** The message type both frames use for the scroll hand-off. */
export const PREVIEW_SCROLL_MESSAGE = "pj:preview-scroll";

/**
 * The scroll hand-off between the workspace and the framed simulation, both same-origin:
 *
 * - `report` (frame → workspace): where the reader has scrolled to, sent as they scroll.
 * - `ready` (frame → workspace): the frame has loaded and wants its position back.
 * - `restore` (workspace → frame): scroll to `y`.
 */
export interface PreviewScrollMessage {
	type: typeof PREVIEW_SCROLL_MESSAGE;
	phase: "report" | "ready" | "restore";
	y: number;
}

/** Build a scroll message; `y` is clamped to a finite, non-negative whole pixel. */
export function scrollMessage(phase: PreviewScrollMessage["phase"], y = 0): PreviewScrollMessage {
	const top = Number.isFinite(y) && y > 0 ? Math.round(y) : 0;
	return { type: PREVIEW_SCROLL_MESSAGE, phase, y: top };
}

/** Narrow an incoming `message` event's data to a scroll message, or `null`. */
export function readScrollMessage(data: unknown): PreviewScrollMessage | null {
	if (!data || typeof data !== "object") return null;
	const value = data as Partial<PreviewScrollMessage>;
	if (value.type !== PREVIEW_SCROLL_MESSAGE) return null;
	if (value.phase !== "report" && value.phase !== "ready" && value.phase !== "restore") return null;
	return scrollMessage(value.phase, typeof value.y === "number" ? value.y : 0);
}
// #endregion
