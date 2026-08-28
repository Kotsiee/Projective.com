/**
 * View feature — the thumbnail rail's pure geometry.
 *
 * Split out of the media column island so the two questions it answers can be tested without a DOM
 * and without a layout pass: how many equal slots fit a given width, and which cards go in them.
 * No JSX, no measurement, no side effects — the island measures and calls in.
 */

/** The rail's measured geometry, in pixels. A non-finite value means "could not be read". */
export interface RailMetrics {
	/** The narrowest a card may be before the rail drops a slot. */
	min: number;
	/** The gap between cards. */
	gap: number;
}

/** The fallback geometry when the stylesheet's values could not be resolved. */
const FALLBACK: RailMetrics = { min: 80, gap: 8 };

/**
 * How many equal cards fit `width`, given the card floor and the gap.
 *
 * N slots occupy `N * min + (N - 1) * gap`, so the count is
 * `floor((width + gap) / (min + gap))` — the `+ gap` is what stops the trailing gap, which does not
 * exist, from costing a card.
 *
 * Always at least 1. A rail that computed 0 slots would render nothing at all, and "the container is
 * momentarily 0px wide" is a state that genuinely happens (a hidden ancestor, a first paint before
 * layout) and must not be allowed to empty the rail permanently.
 */
export function railSlots(width: number, metrics: Partial<RailMetrics> = {}): number {
	const min = Number.isFinite(metrics.min) && (metrics.min as number) > 0
		? metrics.min as number
		: FALLBACK.min;
	const gap = Number.isFinite(metrics.gap) && (metrics.gap as number) >= 0
		? metrics.gap as number
		: FALLBACK.gap;
	if (!Number.isFinite(width) || width <= 0) return 1;
	return Math.max(1, Math.floor((width + gap) / (min + gap)));
}

/** What the rail actually renders for a gallery of `total` images across `slots` equal columns. */
export interface RailPlan {
	/** The grid's column count — always what the rail is sized to, so no card is ever fractional. */
	slots: number;
	/** How many real thumbnails are rendered. */
	realCount: number;
	/** How many images the trailing `+N` card stands in front of. `0` when everything fits. */
	overflow: number;
}

/**
 * Plan the rail.
 *
 * When everything fits, the grid takes exactly `total` columns rather than `slots` — otherwise three
 * images in a five-slot rail would each be stretched to a fifth of the width and read as a layout
 * bug rather than as three images.
 *
 * When it does not fit, the LAST slot becomes the `+N` card and the count is everything behind it
 * (`total - realCount`), never `total - slots`: the `+N` card occupies a slot a thumbnail would
 * otherwise have used, so it is standing in front of its own image too.
 */
export function visibleRail(total: number, slots: number): RailPlan {
	const n = Math.max(1, Math.floor(slots));
	if (total <= n) return { slots: Math.max(1, total), realCount: total, overflow: 0 };
	const realCount = n - 1;
	return { slots: n, realCount, overflow: total - realCount };
}
