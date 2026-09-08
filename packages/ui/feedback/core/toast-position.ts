/**
 * Toast placement — the nine anchors, their logical spellings, and the resolver both share.
 *
 * Pure and DOM-free so the mapping can be tested directly, and so the ONE place a position becomes a
 * class name is a place a test can reach. The stylesheet is the other half of this contract:
 * `toast-position.test.ts` reads `../styles/toast.css` and fails if an anchor here has no rule there,
 * which is the defect this repo keeps meeting from the other side — a class hook nothing styles.
 */

// #region Vocabulary
/**
 * The nine canonical anchors, spelled the way the class name is.
 *
 * The horizontal halves are LOGICAL despite the physical `left`/`right` wording: the stylesheet
 * anchors every one of them with `inset-inline-start` / `inset-inline-end`, so `-left` is the
 * reading-START edge and `-right` the reading-END edge, and both already mirror under `dir="rtl"`.
 * The names are kept because they are what every existing call site passes, and renaming a public
 * prop value to describe behaviour that has not changed buys nothing and breaks callers.
 */
export type ToastAnchor =
	| "top-left"
	| "top-center"
	| "top-right"
	| "center-left"
	| "center"
	| "center-right"
	| "bottom-left"
	| "bottom-center"
	| "bottom-right";

/**
 * The same six edge anchors, spelled logically.
 *
 * Offered because `bottom-right` reads as a promise about the physical viewport corner that the
 * component deliberately does not make — under `dir="rtl"` that stack renders bottom-LEFT. A caller
 * who means "the end of the reading direction" can now say so, and the two spellings resolve to one
 * anchor rather than to two implementations that could drift.
 *
 * There is no `center-center`: `center` already names the middle of both axes, and a second spelling
 * for a point with no start/end component would be a synonym rather than a clarification.
 */
export type ToastLogicalAnchor =
	| "top-start"
	| "top-end"
	| "center-start"
	| "center-end"
	| "bottom-start"
	| "bottom-end";

/** Anything `<Toast position>` accepts — either spelling of the nine anchors. */
export type ToastPosition = ToastAnchor | ToastLogicalAnchor;

/**
 * Where a stack lands when the caller says nothing.
 *
 * Unchanged from before this module existed. Every current mount passes `position` explicitly, so
 * this governs nothing that ships today — which is exactly why it must not move: the only thing a
 * different default could do is silently relocate a stack somebody adds later.
 */
export const DEFAULT_TOAST_POSITION: ToastAnchor = "top-right";
// #endregion

// #region Resolution
/** Logical spelling → the canonical anchor whose rule the stylesheet actually carries. */
const LOGICAL_ANCHORS: Readonly<Record<ToastLogicalAnchor, ToastAnchor>> = {
	"top-start": "top-left",
	"top-end": "top-right",
	"center-start": "center-left",
	"center-end": "center-right",
	"bottom-start": "bottom-left",
	"bottom-end": "bottom-right",
};

/** Every canonical anchor, as a set, for the validity test below. */
const ANCHORS: ReadonlySet<string> = new Set<ToastAnchor>([
	"top-left",
	"top-center",
	"top-right",
	"center-left",
	"center",
	"center-right",
	"bottom-left",
	"bottom-center",
	"bottom-right",
]);

/** The nine anchors in declaration order — the stylesheet-coverage test iterates this. */
export const TOAST_ANCHORS: readonly ToastAnchor[] = [...ANCHORS] as ToastAnchor[];

/** Both logical spellings and their targets, for callers that need to enumerate the aliases. */
export const TOAST_LOGICAL_ANCHORS: Readonly<Record<ToastLogicalAnchor, ToastAnchor>> =
	LOGICAL_ANCHORS;

/**
 * Normalise a caller's `position` to the anchor whose class the stylesheet styles.
 *
 * An unrecognised value falls back to the default rather than passing through. That is not defensive
 * tidiness: `.ui-toast` is `position: fixed` with no inset of its own, so a class with no matching
 * rule leaves the stack at its static position — wherever the mount happened to sit in the flow,
 * which for a body-level overlay is unpredictable and routinely off-screen. A toast in the wrong
 * corner is a nuisance; a toast nobody can see is a failure report that never arrives, and this
 * function is reachable from JavaScript that the type-checker never saw.
 */
export function resolveToastAnchor(position?: ToastPosition): ToastAnchor {
	if (!position) return DEFAULT_TOAST_POSITION;
	const canonical = LOGICAL_ANCHORS[position as ToastLogicalAnchor] ?? position;
	return ANCHORS.has(canonical) ? canonical as ToastAnchor : DEFAULT_TOAST_POSITION;
}
// #endregion
