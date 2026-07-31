import { LocalKeys } from "@web/utils/storage-keys.ts";
import { createZoomStore } from "@web/utils/zoom-store.ts";

/**
 * File Explorer view-state — this surface's instance of the shared cross-island density model
 * (`@web/utils/zoom-store.ts`). The footer **View Control Rig** and the explorer **body** are separate
 * islands; they coordinate through these module-level signals. A single continuous `zoom` (0–1) drives
 * BOTH the list⇄grid switch (a centre threshold) AND the density within each view — so there is
 * deliberately **no** grid/list toggle button: crossing the centre marker transitions the workspace.
 *
 * Only the ramps are local: file cards are thumbnail-led, so they start narrower than a listing card
 * and a table row stays tight enough to scan a long directory.
 */

// #region Store
const store = createZoomStore({
	storageKey: LocalKeys.FILES_ZOOM,
	/** The default density: a comfortable mid grid. */
	initial: 0.62,
	gridColumn: { min: 116, max: 284 },
	listRow: { min: 38, max: 78 },
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
export const filesZoom = store;
// #endregion

// #region Density thresholds
/**
 * Above this list density the row shows an inline media THUMBNAIL; below it the row collapses to a
 * clean category asset ICON (the adaptive-media rule).
 */
export const LIST_THUMB_THRESHOLD = 0.34;

/** Whether the list should render inline thumbnails at the current zoom. */
export function listShowsThumbnails(z: number): boolean {
	return listDensity(z) >= LIST_THUMB_THRESHOLD;
}
// #endregion
