import { computed, signal } from "@preact/signals";
import { LocalKeys, readStored, writeStored } from "@web/utils/storage-keys.ts";

/**
 * Catalogue view-state — the cross-island shared density model for the console, cloned from the File
 * Explorer's (Decision #32). The footer **View Control Rig** and the console **body** are separate
 * islands; they coordinate through these module-level signals. A single continuous `zoom` (0–1) drives
 * BOTH the list⇄grid switch (a centre threshold) AND the density within each view — so there is
 * deliberately **no** grid/list toggle button: crossing the centre marker transitions the workspace.
 *
 * SSR-safe: the signal seeds to a deterministic default; the persisted preference is restored on mount
 * via {@link restoreZoom} to avoid a hydration mismatch. It uses its own `CATALOGUE_ZOOM` key so the
 * seller's catalogue density is independent of their file-explorer density.
 */

// #region Constants
export const ZOOM_MIN = 0;
export const ZOOM_MAX = 1;
/** The exact list⇄grid transition point — the View Control Rig's centre marker. */
export const ZOOM_CENTER = 0.5;
/** Segment ticks on the zoom track. */
export const ZOOM_SEGMENTS = 8;
/** The default density: a comfortable mid grid. */
const ZOOM_DEFAULT = 0.62;
/** Wheel-zoom sensitivity (Ctrl+wheel over the workspace). */
export const ZOOM_WHEEL_STEP = 0.04;
/** Button/keyboard zoom step. */
export const ZOOM_STEP = 0.05;

const clamp01 = (n: number) => Math.max(ZOOM_MIN, Math.min(ZOOM_MAX, n));
// #endregion

// #region Signals
/** The live zoom (0–1). Read `.value` in an island to subscribe. */
export const zoom = signal<number>(ZOOM_DEFAULT);

/** Which console presentation the current zoom selects. */
export const viewMode = computed<"list" | "grid">(
	() => (zoom.value < ZOOM_CENTER ? "list" : "grid"),
);

let restored = false;

/** Restore the persisted zoom once (client-only, on first island mount) — avoids a hydration flash. */
export function restoreZoom(): void {
	if (restored) return;
	restored = true;
	const raw = readStored("local", LocalKeys.CATALOGUE_ZOOM);
	const n = raw ? Number(raw) : NaN;
	if (Number.isFinite(n)) zoom.value = clamp01(n);
}

let persistTimer: number | null = null;

/** Set the zoom immediately (drives the live UI) and persist it on a trailing debounce. */
export function setZoom(next: number): void {
	zoom.value = clamp01(next);
	if (persistTimer !== null) clearTimeout(persistTimer);
	persistTimer = setTimeout(() => {
		writeStored("local", LocalKeys.CATALOGUE_ZOOM, String(zoom.value));
		persistTimer = null;
	}, 200) as unknown as number;
}

/** Nudge the zoom by a signed delta (the Ctrl+wheel / ± button path). */
export function nudgeZoom(delta: number): void {
	setZoom(zoom.value + delta);
}
// #endregion

// #region Density math
/**
 * Grid card minimum column width (px). Grows across the grid half (centre → max) from a compact
 * listing card to a large one; the VirtualGrid packs as many columns as fit and stretches them.
 */
export function gridColWidth(z: number): number {
	const t = clamp01((z - ZOOM_CENTER) / (ZOOM_MAX - ZOOM_CENTER));
	return Math.round(196 + t * 176); // ~196 → 372 px (listing cards run wider than file thumbnails)
}

/** 0–1 density within the LIST half (0 at the far left, 1 at the centre). */
export function listDensity(z: number): number {
	return clamp01(z / ZOOM_CENTER);
}

/** List/table row height (px) — grows with density so inline thumbnails have room. */
export function listRowHeight(z: number): number {
	return Math.round(48 + listDensity(z) * 36); // 48 → 84 px
}
// #endregion
