/**
 * commit-review — the pure half of {@link CommitReview}: its fact rows and the contract of its actions.
 *
 * A review step ends in exactly two controls — the escape (a tier-5 text Cancel, first in reading and
 * tab order) and the ONE commit (the tier-1 amber pill, last), or a lone Close when there is nothing to
 * commit. Kept free of components and stylesheets so the contract is unit-tested
 * (`components/CommitReview.test.tsx`).
 */

// #region Types
/** One fact the reader confirms before committing: "From · Helia Finance wallet". */
export interface CommitReviewRow {
	label: string;
	value: string;
	/** A figure (an amount, a balance, a date) — set in `tabular-nums`. */
	tabular?: boolean;
}

/**
 * How the review commits: `action` runs the caller's commit in place; `link` navigates to where the
 * commit happens (a hand-off into another flow); `none` offers no commit at all, only a way out.
 */
export type CommitReviewMode = "action" | "link" | "none";

/** One rendered control of the review's action group, in order. */
export interface CommitReviewAction {
	/** `cancel` and `close` dismiss; `commit` commits. */
	role: "cancel" | "close" | "commit";
	label: string;
	/**
	 * The amount after the label ("Pay" · "US$640.00"), set in its own tabular, left-to-right isolated
	 * run (§A Figures); `null` when the control carries none, or reads "Try again".
	 */
	figure: string | null;
	/** A `<button>`, or an anchor for a `link` commit. */
	element: "button" | "link";
	/** The Button severity and variant this control wears (DESIGN_SYSTEM §B.8, the matrix). */
	severity: "primary" | "accent";
	variant: "text" | "filled";
	rounded: boolean;
	disabled: boolean;
	loading: boolean;
}

/** What {@link commitReviewActions} decides from. */
export interface CommitReviewActionsInput {
	mode: CommitReviewMode;
	commitLabel: string;
	/** The amount the commit moves, said after its label ("Pay US$640.00"). */
	commitFigure?: string | null;
	/** Default "Cancel" (or "Close" when there is nothing to commit). */
	cancelLabel?: string;
	/** The commit is in flight: Cancel is disabled and the commit shows its spinner. */
	busy: boolean;
	/** The last commit was refused: the commit reads "Try again". */
	failed: boolean;
}
// #endregion

// #region Contract
/**
 * The review's controls, in DOM order: Cancel (text) then the one commit (accent, filled, rounded), or
 * a lone text Close when `mode` is `none`. Never more than one fill.
 */
export function commitReviewActions(input: CommitReviewActionsInput): CommitReviewAction[] {
	const escape = (role: "cancel" | "close", label: string): CommitReviewAction => ({
		role,
		label,
		figure: null,
		element: "button",
		severity: "primary",
		variant: "text",
		rounded: false,
		disabled: input.busy,
		loading: false,
	});
	if (input.mode === "none") return [escape("close", input.cancelLabel ?? "Close")];
	const retry = input.failed && input.mode === "action";
	return [
		escape("cancel", input.cancelLabel ?? "Cancel"),
		{
			role: "commit",
			label: retry ? "Try again" : input.commitLabel,
			figure: retry ? null : input.commitFigure ?? null,
			element: input.mode === "link" ? "link" : "button",
			severity: "accent",
			variant: "filled",
			rounded: true,
			disabled: input.busy,
			loading: input.busy && input.mode === "action",
		},
	];
}

/** The `Dialog` settings a review opens with ({@link commitReviewDialog}). */
export interface CommitReviewDialog {
	role: "alertdialog";
	/** The header's × close. */
	closable: boolean;
	closeOnEscape: boolean;
	/** A click on the scrim. */
	dismissableMask: boolean;
	/** Where focus opens: the action group, whose first stop is the text Cancel — never the commit. */
	initialFocus: "actions";
}

/**
 * The review's dialog contract: an `alertdialog` (the reader is about to move money) that opens focus
 * on its action group, so Cancel is the first stop; while the commit is in flight nothing dismisses it
 * — no Escape, no scrim, no × — so the answer never lands on a review that has gone.
 */
export function commitReviewDialog(sending: boolean): CommitReviewDialog {
	return {
		role: "alertdialog",
		closable: !sending,
		closeOnEscape: !sending,
		dismissableMask: !sending,
		initialFocus: "actions",
	};
}

/**
 * Where focus goes when a commit comes back refused: the commit itself, now reading "Try again", or the
 * lone Close when nothing is left to commit. The commit was disabled while in flight, so the browser
 * had dropped focus to the document; without this the reader would be left outside the review it is
 * still in. Returns an index into `actions` (the action group's controls, in DOM order).
 */
export function commitReviewRefocusIndex(actions: readonly CommitReviewAction[]): number {
	const commit = actions.findIndex((action) => action.role === "commit");
	return commit >= 0 ? commit : actions.length - 1;
}

/** The Button classes an anchor commit wears, so a navigation reads as the same pill. */
export function commitLinkClass(
	action: CommitReviewAction,
	size: "sm" | "md" | "lg" = "md",
): string {
	return [
		"ui-button",
		`ui-button--${action.severity}`,
		`ui-button--${action.variant}`,
		`ui-button--size-${size}`,
		action.rounded ? "ui-button--rounded" : null,
		"ui-commit-review__link",
	].filter(Boolean).join(" ");
}
// #endregion
