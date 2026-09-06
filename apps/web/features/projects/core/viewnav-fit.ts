/**
 * The Project Details footer nav's fit arithmetic — how many view links survive inline at a given
 * lane width, and how many fold into the kebab.
 *
 * Pure and separate from the component on purpose. The fold is driven by a `ResizeObserver`, and an
 * observer needs a rendering opportunity to deliver: in a backgrounded or non-compositing tab it
 * never fires at all, so the behaviour cannot be watched where a lot of this repo's verification
 * happens. Keeping the arithmetic here means the part that can actually be WRONG — the greedy fit,
 * the reserve, the boundaries — is pinned by test rather than by watching a lane being dragged.
 */

// #region Model
/** Everything the fit needs, in CSS pixels, measured from the live DOM by the component. */
export interface ViewNavGeometry {
	/** The footer row's CONTENT-box inline size (its padding already subtracted). */
	containerW: number;
	/** Natural outer widths of the primary links, in row order (border box + inline margins). */
	btn: readonly number[];
	/** Column gap between the links inside `.proj-viewnav__links`. */
	gapLinks: number;
	/** Column gap of `.proj-viewnav` — what the row spends between the toggle and the links block. */
	gapRow: number;
	/** Outer width of the collapse/expand toggle; `0` when it is not rendered. */
	collapse: number;
	/** Outer width of the kebab trigger. */
	kebab: number;
}

/** How the row splits: the first `visible` links stay inline, the remaining `folded` go in the menu. */
export interface ViewNavFit {
	visible: number;
	folded: number;
}
// #endregion

/** A couple of pixels of slack so a link that only just fits is never clipped by sub-pixel rounding. */
export const FIT_SLACK = 2;

/**
 * Fit as many primary links as `containerW` allows, folding from the RIGHTMOST inward.
 *
 * The collapse toggle is subtracted before anything else and never folds: it is the control that
 * gets the lane back, so losing it to a narrow lane would strand the reader in the narrow lane.
 *
 * The row is measured WITHOUT the kebab first. The kebab exists only to hold folded links, so a lane
 * wide enough for all of them needs no kebab — and reserving one anyway is how the last link gets
 * folded away to make room for the button that exists only to hold it. Only once the full set is
 * known not to fit is the kebab reserved and the row re-fitted around it.
 *
 * That makes the visible count skip a value, and the skip is honest rather than a rounding artefact:
 * a kebab occupies exactly one slot, so at the width where the last link no longer fits, neither
 * does the one before it once the kebab takes its place.
 */
export function fitViewNav(geo: ViewNavGeometry): ViewNavFit {
	const total = geo.btn.length;
	const avail = geo.containerW - (geo.collapse > 0 ? geo.collapse + geo.gapRow : 0) - FIT_SLACK;

	const fit = (room: number): number => {
		let used = 0;
		let count = 0;
		for (const w of geo.btn) {
			const next = used + (count > 0 ? geo.gapLinks : 0) + w;
			if (next > room) break;
			used = next;
			count++;
		}
		return count;
	};

	if (fit(avail) === total) return { visible: total, folded: 0 };
	const visible = fit(avail - (geo.kebab + geo.gapLinks));
	return { visible, folded: total - visible };
}
