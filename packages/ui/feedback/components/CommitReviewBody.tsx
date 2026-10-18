import type { ComponentChildren, JSX } from "preact";
import { cx } from "../../core/cx.ts";
import type { CommitReviewRow } from "../core/commit-review.ts";

// #region Props
/** Props for {@link CommitReviewBody}. */
export interface CommitReviewBodyProps {
	/** The amount being committed, server-formatted ("US$640.00"); omitted renders no figure. */
	total?: string | null;
	/** The facts the reader confirms, in reading order. */
	rows: readonly CommitReviewRow[];
	/** What committing does, in one sentence ("This can't be reversed."). */
	consequence?: string | null;
	/** A refusal or status for the step — an `InlineNotice` or `Alert` the caller renders. */
	notice?: ComponentChildren;
	class?: string;
}
// #endregion

/**
 * The review step's body: the figure, the facts as a description list (label · value, one hairline
 * between rows; a tabular value's figure isolated left-to-right), the consequence, then any notice.
 * Kept free of the stylesheet import so the markup is unit-testable: whoever renders it imports
 * `commit-review.css` itself — {@link CommitReview} does, and so does any dialog that composes its own
 * frame (the wallet's movement dialog, `WalletDialogs.tsx`), never relying on a barrel's side effect.
 */
export function CommitReviewBody(props: CommitReviewBodyProps): JSX.Element {
	const { total, rows, consequence, notice, class: className } = props;
	return (
		<div class={cx("ui-commit-review", className)}>
			{total && <p class="ui-commit-review__total">{total}</p>}
			{rows.length > 0 && (
				<dl class="ui-commit-review__rows">
					{rows.map((row) => (
						<div class="ui-commit-review__row" key={row.label}>
							<dt class="ui-commit-review__label">{row.label}</dt>
							<dd
								class={cx(
									"ui-commit-review__value",
									row.tabular && "ui-commit-review__value--tabular",
								)}
							>
								{row.tabular
									? <span class="ui-commit-review__figure">{row.value}</span>
									: row.value}
							</dd>
						</div>
					))}
				</dl>
			)}
			{consequence && <p class="ui-commit-review__note">{consequence}</p>}
			{notice}
		</div>
	);
}

/**
 * A commit's label with its amount: "Pay" then the figure in its own run — tabular and isolated
 * left-to-right (§A Figures), so the amount keeps its order and its column of digits inside a pill.
 * Stylesheet-free like the body; any Button or anchor can carry it.
 */
export function CommitLabel(props: { label: string; figure?: string | null }): JSX.Element {
	return (
		<>
			{props.label}
			{props.figure && (
				<>
					{" "}
					<span class="ui-commit-review__commit-figure">{props.figure}</span>
				</>
			)}
		</>
	);
}
