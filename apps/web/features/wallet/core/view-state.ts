import { LocalKeys } from "@web/utils/storage-keys.ts";
import { createZoomStore } from "@web/utils/zoom-store.ts";

/**
 * Wallet view-state — the ledger's instance of the shared cross-island density model
 * (`@web/utils/zoom-store.ts`). The footer rig and the ledger body are separate islands coordinating
 * through these module-level signals: one continuous `zoom` (0–1) drives the compact ⇄ comfortable row
 * density and, above the centre marker, the card presentation — so there is no grid/list toggle button
 * here either.
 *
 * Its own `WALLET_ZOOM` key keeps the ledger density independent of the file and catalogue densities,
 * and it opens BELOW the centre marker: a ledger is read as a dense table first, unlike a file grid.
 */

// #region Store
const store = createZoomStore({
	storageKey: LocalKeys.WALLET_ZOOM,
	/** The ledger opens in the dense list by default. */
	initial: 0.3,
	gridColumn: { min: 240, max: 380 },
	listRow: { min: 44, max: 72 },
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
export const walletZoom = store;
// #endregion
