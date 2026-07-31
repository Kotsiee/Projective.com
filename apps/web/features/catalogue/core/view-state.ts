import { LocalKeys } from "@web/utils/storage-keys.ts";
import { createZoomStore } from "@web/utils/zoom-store.ts";

/**
 * Catalogue view-state — the console's instance of the shared cross-island density model
 * (`@web/utils/zoom-store.ts`). The footer **View Control Rig** and the console **body** are separate
 * islands coordinating through these module-level signals; a single continuous `zoom` (0–1) drives
 * BOTH the list⇄grid switch (a centre threshold) AND the density within each view, so there is
 * deliberately no grid/list toggle button.
 *
 * Its own `CATALOGUE_ZOOM` key keeps the seller's catalogue density independent of their file-explorer
 * density, and the ramps run wider because a listing card carries price, metrics and a status chip
 * where a file card carries a thumbnail.
 */

// #region Store
const store = createZoomStore({
	storageKey: LocalKeys.CATALOGUE_ZOOM,
	/** The default density: a comfortable mid grid. */
	initial: 0.62,
	gridColumn: { min: 196, max: 372 },
	listRow: { min: 48, max: 84 },
});

export const {
	ZOOM_MIN,
	ZOOM_MAX,
	ZOOM_CENTER,
	ZOOM_SEGMENTS,
	ZOOM_STEP,
	ZOOM_WHEEL_STEP,
	zoom,
	viewMode,
	restoreZoom,
	setZoom,
	nudgeZoom,
	gridColWidth,
	listDensity,
	listRowHeight,
} = store;

/** The whole store, for the shared `ViewZoomRig` / `useCtrlWheelZoom`, which take it as one value. */
export const catalogueZoom = store;
// #endregion
