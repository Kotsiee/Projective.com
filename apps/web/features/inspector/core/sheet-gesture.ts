/**
 * sheet-gesture — the pure decisions behind the bottom sheet's swipe: how far the panel follows the
 * finger, how fast the finger was moving on release, and where the sheet settles.
 */

// #region Contract
/** The sheet's resting heights: content-sized (capped), or as tall as its host allows. */
export type SheetSnap = "half" | "full";

/** Where a released drag sends the sheet. */
export type SheetOutcome = SheetSnap | "dismiss";

/** One pointer sample of a drag: time in ms, vertical position in px. */
export interface DragSample {
	t: number;
	y: number;
}

/** A finished drag, as {@link sheetRelease} reads it. */
export interface SheetRelease {
	snap: SheetSnap;
	/** Finger travel in px since the press; positive is downward. */
	travel: number;
	/** Release velocity in px/ms; positive is downward. */
	velocity: number;
	/** The panel's height in px when the drag began. */
	height: number;
}
// #endregion

// #region Tuning
/** Travel before a press on the grip becomes a drag (and captures the pointer). */
export const SHEET_DRAG_SLOP_PX = 6;
/** Share of the panel's height a downward drag must cover to leave its snap. */
export const SHEET_DISMISS_FRACTION = 0.3;
/** Upward travel that expands a half sheet to full. */
export const SHEET_EXPAND_PX = 48;
/** A release at least this fast (px/ms) counts as a fling in its direction. */
export const SHEET_FLING_VELOCITY = 0.5;
/** How far an upward over-drag may stretch the panel at each snap. */
export const SHEET_STRETCH_PX: Readonly<Record<SheetSnap, number>> = { half: 48, full: 16 };
/** The window of samples the release velocity is measured over. */
export const SHEET_VELOCITY_WINDOW_MS = 100;
// #endregion

// #region Decisions
/**
 * The panel's offset for a drag of `travel` px: it follows a downward drag one to one, and resists
 * an upward one, approaching {@link SHEET_STRETCH_PX} for its snap without reaching it.
 */
export function sheetDragOffset(snap: SheetSnap, travel: number): number {
	if (!Number.isFinite(travel) || travel === 0) return 0;
	if (travel > 0) return travel;
	const limit = SHEET_STRETCH_PX[snap];
	const up = -travel;
	return -(limit * up) / (up + limit);
}

/** Release velocity in px/ms from the samples inside the last {@link SHEET_VELOCITY_WINDOW_MS}. */
export function releaseVelocity(samples: readonly DragSample[]): number {
	const last = samples[samples.length - 1];
	if (!last) return 0;
	let first = last;
	for (let i = samples.length - 2; i >= 0; i--) {
		if (last.t - samples[i].t > SHEET_VELOCITY_WINDOW_MS) break;
		first = samples[i];
	}
	const dt = last.t - first.t;
	return dt > 0 ? (last.y - first.y) / dt : 0;
}

/**
 * Where the sheet settles. Down: a drag under {@link SHEET_DISMISS_FRACTION} of the height that is
 * also slow snaps back; past it (or flung), a half sheet dismisses and a full one drops to half
 * (or dismisses when dragged twice as far). Up: a half sheet expands once dragged
 * {@link SHEET_EXPAND_PX} or flung upward; a full sheet stays.
 */
export function sheetRelease(release: SheetRelease): SheetOutcome {
	const { snap, travel, velocity, height } = release;
	if (!Number.isFinite(travel) || !Number.isFinite(velocity)) return snap;
	if (travel < 0) {
		const expand = -travel >= SHEET_EXPAND_PX || velocity <= -SHEET_FLING_VELOCITY;
		return snap === "half" && expand ? "full" : snap;
	}
	const reach = Math.max(height, 1) * SHEET_DISMISS_FRACTION;
	const far = travel >= reach;
	const flung = velocity >= SHEET_FLING_VELOCITY && travel >= SHEET_DRAG_SLOP_PX;
	if (!far && !flung) return snap;
	if (snap === "half") return "dismiss";
	return travel >= reach * 2 ? "dismiss" : "half";
}
// #endregion
