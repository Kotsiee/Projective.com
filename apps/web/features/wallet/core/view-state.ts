import { computed, signal } from "@preact/signals";
import { LocalKeys, readStored, writeStored } from "@web/utils/storage-keys.ts";

/**
 * Wallet view-state — the cross-island density model for the Transactions ledger, cloned from the File
 * Explorer's (Decision #32). The footer **View Control Rig** and the ledger **body** are separate
 * islands coordinating through these module-level signals: a single continuous `zoom` (0–1) drives BOTH
 * the compact-list ⇄ comfortable-list density AND (above the centre marker) a card grid — so there is no
 * grid/list toggle button; crossing the centre marker transitions the workspace. Its own `WALLET_ZOOM`
 * key keeps the ledger density independent of the file/catalogue density.
 */

// #region Constants
export const ZOOM_MIN = 0;
export const ZOOM_MAX = 1;
/** The exact list ⇄ grid transition point — the rig's centre marker. */
export const ZOOM_CENTER = 0.5;
export const ZOOM_SEGMENTS = 8;
const ZOOM_DEFAULT = 0.3; // the ledger opens in the dense list by default
export const ZOOM_WHEEL_STEP = 0.04;
export const ZOOM_STEP = 0.05;

const clamp01 = (n: number) => Math.max(ZOOM_MIN, Math.min(ZOOM_MAX, n));
// #endregion

// #region Signals
/** The live zoom (0–1). Read `.value` in an island to subscribe. */
export const zoom = signal<number>(ZOOM_DEFAULT);

/** Which ledger presentation the current zoom selects. */
export const viewMode = computed<"list" | "grid">(
	() => (zoom.value < ZOOM_CENTER ? "list" : "grid"),
);

let restored = false;

/** Restore the persisted zoom once (client-only, first island mount) — avoids a hydration flash. */
export function restoreZoom(): void {
	if (restored) return;
	restored = true;
	const raw = readStored("local", LocalKeys.WALLET_ZOOM);
	const n = raw ? Number(raw) : NaN;
	if (Number.isFinite(n)) zoom.value = clamp01(n);
}

let persistTimer: number | null = null;

/** Set the zoom immediately and persist it on a trailing debounce. */
export function setZoom(next: number): void {
	zoom.value = clamp01(next);
	if (persistTimer !== null) clearTimeout(persistTimer);
	persistTimer = setTimeout(() => {
		writeStored("local", LocalKeys.WALLET_ZOOM, String(zoom.value));
		persistTimer = null;
	}, 200) as unknown as number;
}

/** Nudge the zoom by a signed delta (Ctrl+wheel / ± button path). */
export function nudgeZoom(delta: number): void {
	setZoom(zoom.value + delta);
}
// #endregion

// #region Density math
/** 0–1 density within the LIST half (0 far-left, 1 at the centre). */
export function listDensity(z: number): number {
	return clamp01(z / ZOOM_CENTER);
}

/** Ledger row height (px) — grows with density. */
export function listRowHeight(z: number): number {
	return Math.round(44 + listDensity(z) * 28); // 44 → 72 px
}

/** Grid card minimum column width (px) for the card presentation above the centre marker. */
export function gridColWidth(z: number): number {
	const t = clamp01((z - ZOOM_CENTER) / (ZOOM_MAX - ZOOM_CENTER));
	return Math.round(240 + t * 140); // 240 → 380 px
}
// #endregion
