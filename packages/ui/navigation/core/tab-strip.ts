/**
 * Pure geometry + stepping for {@link TabStrip} (`components/TabStrip.tsx`). No DOM: the component
 * measures, these decide — so the collapse thresholds and the circular step are unit-tested without a
 * layout engine.
 */

// #region Collapse decision
/** The measured inputs to {@link shouldCollapseTabs}, all in CSS pixels. */
export interface TabStripGeometry {
	/** The host row's content-box inline size (its width minus inline padding). */
	headerInner: number;
	/** The tab strip's natural (max-content) width at the current breakpoint's tab styling. */
	tabsNatural: number;
	/** The width the trailing action tray's visible controls actually occupy. */
	actionsContent: number;
	/** The host row's flex column gap. */
	gap: number;
}

/**
 * Whether a CENTRED strip (the `header` tone) would collide with the trailing actions, so the compact
 * layout must take over.
 *
 * The header centres its tab strip between two equal flex tracks, so each side keeps
 * `(inner − tabs) / 2 − gap`. The strip collides once that side is narrower than the action tray plus
 * one more gap of clearance ("approaching" counts, not only touching).
 *
 * The rule is a function of the natural strip width rather than of the strip's current box, so it gives
 * the same answer whichever layout is showing — the compact layout's own narrower width can never feed
 * back into the decision and flip it back (no hysteresis band needed).
 */
export function shouldCollapseTabs(g: TabStripGeometry, tabCount: number): boolean {
	if (tabCount < 2) return false;
	const side = (g.headerInner - g.tabsNatural) / 2 - g.gap;
	return side < g.actionsContent + g.gap;
}

/** Sub-pixel slack between a fractional natural width and a rounded track width. */
export const TRACK_SLACK_PX = 1;

/**
 * Whether a strip that FILLS its own track (the `lane` tone) no longer fits it. The track is the
 * strip's own content box, which the host sizes independently of the strip's contents, so the compact
 * layout cannot feed back here either.
 */
export function overflowsTrack(track: number, tabsNatural: number, tabCount: number): boolean {
	if (tabCount < 2 || track <= 0) return false;
	return tabsNatural - track > TRACK_SLACK_PX;
}
// #endregion

// #region Circular stepping
/** The index `delta` steps from `index` in a ring of `count` (wraps both ways; `-1` → last). */
export function stepIndex(index: number, delta: number, count: number): number {
	if (count <= 0) return 0;
	return (((index + delta) % count) + count) % count;
}
// #endregion

// #region Swipe
/** Minimum horizontal travel (px) before a drag on the active tab counts as a swipe. */
export const SWIPE_THRESHOLD_PX = 44;

/**
 * Resolve a finished drag into a tab step: a swipe LEFT advances (`1`), a swipe RIGHT goes back (`-1`),
 * anything shorter than the threshold or more vertical than horizontal is a tap/scroll (`0`).
 */
export function swipeStep(dx: number, dy: number, threshold = SWIPE_THRESHOLD_PX): -1 | 0 | 1 {
	if (Math.abs(dx) < threshold || Math.abs(dx) <= Math.abs(dy)) return 0;
	return dx < 0 ? 1 : -1;
}
// #endregion
