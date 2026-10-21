import { signal } from "@preact/signals";
import { LocalKeys, readStored, writeStored } from "@web/utils/storage-keys.ts";
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
	displayZoom,
	toggleViewMode,
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

// #region People store (the Members module)
/**
 * The Members module's People density — a store of its own (Teams C2): People opens on the
 * comparison TABLE (Decision #224 — the DataTable is the default reading of a roster), where the roster
 * index opens on cards. Crossing the centre marker still switches table ⇄ cards; the card ramp is the
 * project roster's, whose card the People grid draws (Decision #319), and the row ramp the roster's.
 */
export const peopleZoom = createZoomStore({
	storageKey: LocalKeys.WORKSPACE_PEOPLE_ZOOM,
	/** The default density: a comfortable table, the list half's upper third. */
	initial: 0.38,
	/** The project roster's card ramp (`member-view-state.ts`): the cards are its card (Decision #319). */
	gridColumn: { min: 224, max: 340 },
	listRow: { min: 44, max: 76 },
});

/** The zoom store a console module's footer rig drives — People's own on Members, else the roster's. */
export function zoomStoreFor(module: string | null): typeof store {
	return module === "members" ? peopleZoom : store;
}
// #endregion

// #region People reading (the Members module)
/**
 * The reader's last reading of the Members people — `people` (the table ⇄ cards) or `chart` — so the
 * header band's Members tab, drawn on Roles too, returns a reader who left the org chart to the org
 * chart (Decision #319). The address stays the truth on the page itself (`?view=`); this only decides
 * where the tab points. `null` until a client restores it, so the server and the first client frame
 * both point the tab at the bare Members address.
 */
export const peopleReading = signal<string | null>(null);

/** Read the persisted reading into {@link peopleReading} (client mount only). */
export function restorePeopleReading(): void {
	peopleReading.value = readStored("local", LocalKeys.WORKSPACE_PEOPLE_READING);
}

/** Remember the reading the Members body is showing. */
export function rememberPeopleReading(reading: string): void {
	if (peopleReading.peek() === reading) return;
	peopleReading.value = reading;
	writeStored("local", LocalKeys.WORKSPACE_PEOPLE_READING, reading);
}
// #endregion

// #region Org chart viewport (footer rig ↔ the chart canvas)
/**
 * The org chart's viewport, shared by the two hydration roots that drive it: the canvas in the body
 * (wheel, pinch, drag, keyboard) and the footer rig's zoom (`ZoomSlider` + Fit). They cannot exchange
 * props, so — like the density stores above — they meet in module signals. The canvas is the one
 * authority on the transform: the rig only ever ASKS through {@link chartCommand}, and reads back the
 * zoom the canvas settled on through {@link chartZoom}.
 */

/** The furthest the chart zooms out — a whole org of a few dozen people fits a laptop screen. */
export const CHART_ZOOM_MIN = 0.25;
/** The closest it zooms in — twice the cards' own size, enough to read a long title. */
export const CHART_ZOOM_MAX = 2;
/** One ± press, wheel notch or arrow key. */
export const CHART_ZOOM_STEP = 0.125;

/** The zoom the canvas is at (or travelling to) — the footer slider's value. */
export const chartZoom = signal(1);

/** A request the canvas answers: zoom about the viewport's centre, or fit the whole chart in view. */
export type ChartCommand =
	| { kind: "zoom"; value: number; animate: boolean; seq: number }
	| { kind: "fit"; seq: number };

/** The latest request — a pulse: `seq` makes a repeated request a new value. */
export const chartCommand = signal<ChartCommand | null>(null);

let commandSeq = 0;

/** Ask the canvas for a zoom: a drag lands at once, a step eases (the zoom stores' split). */
export function requestChartZoom(value: number, animate: boolean): void {
	chartCommand.value = { kind: "zoom", value, animate, seq: ++commandSeq };
}

/** Ask the canvas to fit the whole chart in view. */
export function requestChartFit(): void {
	chartCommand.value = { kind: "fit", seq: ++commandSeq };
}
// #endregion
