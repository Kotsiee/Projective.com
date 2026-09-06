/**
 * Editor resize arithmetic — the pure half of the drag.
 *
 * A drag's live behaviour cannot be observed by a static assertion, and per this repo's own harness
 * notes it cannot reliably be observed in a preview pane either, because a frame may never be
 * composited. So every decision that can be made from numbers alone is made here and pinned by
 * `resize.test.ts`, and `hooks/useEditorResize.ts` is left holding only the event plumbing.
 *
 * ## Why direction is a parameter and not an assumption
 *
 * The inline-end handle sits on the RIGHT in a left-to-right document and on the LEFT in a
 * right-to-left one, so the same rightward pointer travel has to widen the box in one and narrow it
 * in the other. Screen coordinates know nothing about that, which is why {@link inlineDelta} takes
 * the resolved direction rather than reading a global — and why the keyboard mapping takes it too:
 * ArrowRight grows the box in LTR and shrinks it in RTL, for exactly the same reason.
 *
 * @module
 */

// #region Lengths
/**
 * Normalise a dimension prop into a CSS length.
 *
 * A bare number is pixels — the unit a caller who wrote `160` meant — and a string is passed through
 * untouched so a caller can write `20rem`, `40ch` or `min(50vh, 400px)` and have it resolve in the
 * engine rather than here. Nothing is validated: an unparseable string produces an invalid custom
 * property, which the browser drops back to the declared fallback, and that is a better failure than
 * this module inventing a number the caller never asked for.
 */
export function cssLength(value: number | string): string {
	return typeof value === "number" ? `${value}px` : value;
}

/**
 * Read a used length out of a computed style, in pixels.
 *
 * `getComputedStyle` resolves `em`, `rem`, `%` and `calc()` to used pixel values, which is what makes
 * it the right place to learn a bound the consumer expressed in any unit at all — parsing the
 * author's own string would mean re-implementing the cascade. `none` (an unset `max-*`) and anything
 * unparseable return the supplied fallback.
 */
export function usedPx(value: string | null | undefined, fallback: number): number {
	if (!value || value === "none" || value === "auto") return fallback;
	const parsed = Number.parseFloat(value);
	return Number.isFinite(parsed) ? parsed : fallback;
}

/** Clamp a size into `[min, max]`. `Infinity` is a legitimate `max` and means "no ceiling". */
export function clampSize(px: number, min: number, max: number): number {
	if (!Number.isFinite(px)) return min;
	const ceiling = Number.isFinite(max) ? Math.max(min, max) : Infinity;
	return Math.min(Math.max(px, min), ceiling);
}
// #endregion

// #region Geometry
/**
 * The widest the control may become without pushing its own parent into overflow.
 *
 * The parent's `clientWidth` is its padding box, so the padding has to come off to reach the content
 * width the control actually sits in. A resize that can produce horizontal document overflow is a
 * defect on every surface in this product, and a ceiling the caller cannot forget is how that is
 * prevented — rather than a `maxWidth` prop that each call site would have to remember to pass.
 */
export function availableInlineSize(
	parentClientWidth: number,
	paddingStart: number,
	paddingEnd: number,
): number {
	const available = parentClientWidth - paddingStart - paddingEnd;
	return Number.isFinite(available) && available > 0 ? available : parentClientWidth;
}

/**
 * Signed inline growth for a pointer that has travelled `dx` screen pixels to the right.
 *
 * Rightward travel grows the box in a left-to-right document and shrinks it in a right-to-left one,
 * because the handle it is dragging is at the opposite physical edge.
 */
export function inlineDelta(dx: number, rtl: boolean): number {
	return rtl ? -dx : dx;
}
// #endregion

// #region Keyboard
/** Which dimensions a handle drives. */
export type ResizeAxis = "block" | "inline" | "both";

/** One arrow press moves the edge this far; holding Shift moves it a screenful of lines instead. */
export const KEY_STEP_PX = 16;
export const KEY_STEP_COARSE_PX = 64;

export interface KeyResize {
	/** Signed pixels to add to the block size, if this key touches it. */
	block: number;
	/** Signed pixels to add to the inline size, if this key touches it. */
	inline: number;
}

/**
 * Map an arrow key onto a resize, or `null` when the key is not one this handle answers.
 *
 * Returning `null` rather than a zero delta is what lets the caller decide whether to consume the
 * event: a handle that swallowed every keystroke would trap Tab and Escape inside itself.
 */
export function keyResize(
	key: string,
	axis: ResizeAxis,
	options: { rtl?: boolean; coarse?: boolean } = {},
): KeyResize | null {
	const step = options.coarse ? KEY_STEP_COARSE_PX : KEY_STEP_PX;
	const rtl = options.rtl ?? false;
	const touchesBlock = axis === "block" || axis === "both";
	const touchesInline = axis === "inline" || axis === "both";

	if (touchesBlock && key === "ArrowDown") return { block: step, inline: 0 };
	if (touchesBlock && key === "ArrowUp") return { block: -step, inline: 0 };
	if (touchesInline && key === "ArrowRight") return { block: 0, inline: inlineDelta(step, rtl) };
	if (touchesInline && key === "ArrowLeft") return { block: 0, inline: inlineDelta(-step, rtl) };
	return null;
}
// #endregion
