// #region Press resolution
/** A pointer position in client coordinates. */
export interface PressPoint {
	x: number;
	y: number;
}

/** Maximum travel, in px, between press and release that still counts as a click on the surface. */
export const PRESS_SLOP = 6;

/**
 * Whether a click on a dismiss surface (a scrim, a lightbox stage) should close its overlay.
 *
 * True only when the press STARTED on the surface itself (`start` is non-null), the click lands on
 * the surface itself (`onSurface`), and the pointer barely moved. This rejects a text selection or
 * drag released over the scrim, a pan that ends where it began, and a click whose press belonged to
 * a layer that closed and unmounted mid-gesture.
 */
export function isDismissPress(
	start: PressPoint | null,
	end: PressPoint,
	onSurface: boolean,
): boolean {
	if (!start || !onSurface) return false;
	return Math.hypot(end.x - start.x, end.y - start.y) <= PRESS_SLOP;
}
// #endregion
