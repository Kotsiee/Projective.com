import { LocalKeys } from "@web/utils/storage-keys.ts";
import { createZoomStore } from "@web/utils/zoom-store.ts";

/**
 * Workspace view-state — the console's instance of the shared cross-island density model
 * (`@web/utils/zoom-store.ts`), so `/teams` and `/businesses` scale their collections exactly as the
 * File Explorer, the Submissions explorer, the Catalogue console and the Wallet ledger do.
 *
 * This replaces the surface's former pair of discrete `Cards | Table` buttons. One continuous `zoom`
 * (0–1) now drives BOTH the table⇄cards switch (the centre marker) AND the card size within the grid
 * half, which is why the footer band no longer carries a presentation toggle: crossing the marker IS
 * the switch, and `Ctrl`+wheel over the collection reaches it without travelling to the band at all.
 *
 * One key across both kinds (`WORKSPACE_ZOOM`): a Team and a Business are one surface parameterised by
 * kind, so a reader who set a comfortable density on their teams expects to find it on their
 * businesses. The ramps are wider than the file explorer's because a workspace card carries an avatar,
 * a role chip and a member count where a file card carries a thumbnail.
 */

// #region Store
const store = createZoomStore({
	storageKey: LocalKeys.WORKSPACE_ZOOM,
	/** The default density: a comfortable card grid, the presentation the roster has always opened in. */
	initial: 0.62,
	gridColumn: { min: 240, max: 400 },
	listRow: { min: 44, max: 76 },
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
export const workspaceZoom = store;
// #endregion
