import type { JSX } from "preact";
import { type Signal, useSignal } from "@preact/signals";
import { useRef } from "preact/hooks";
import "../styles/commit-review.css";
import { Dialog } from "./Dialog.tsx";
import { Button } from "../../fields/components/Button.tsx";
import { InlineNotice } from "../components/InlineNotice.tsx";
import { CommitLabel, CommitReviewBody } from "../components/CommitReviewBody.tsx";
import {
	commitLinkClass,
	commitReviewActions,
	commitReviewDialog,
	type CommitReviewMode,
	commitReviewRefocusIndex,
	type CommitReviewRow,
} from "../core/commit-review.ts";
import { useIsMobile } from "../../hooks/useMediaQuery.ts";
import { Icon } from "../../icons/mod.ts";

// #region Props
/** Props for {@link CommitReview}. */
export interface CommitReviewProps {
	/** Visibility. MUST be a Signal: the review opens from a control elsewhere and closes itself. */
	visible: Signal<boolean>;
	/** The dialog's title ("Pay this invoice"). */
	title: string;
	/** The amount being committed, server-formatted. */
	total?: string | null;
	/** The facts the reader confirms before committing. */
	rows: readonly CommitReviewRow[];
	/** What committing does, in one sentence. */
	consequence?: string | null;
	/** The commit's verb ("Pay"). */
	commitLabel?: string;
	/**
	 * The amount after the verb ("US$640.00"), set as a tabular, left-to-right isolated figure inside the
	 * pill. Dropped while the commit reads "Try again".
	 */
	commitFigure?: string | null;
	/**
	 * Commit in place. Resolves `null` when it went through — the review closes — or the reader's
	 * sentence for a refusal, shown in the review with the commit relabelled "Try again".
	 */
	onCommit?: () => Promise<string | null>;
	/**
	 * Commit by navigating instead — a hand-off into the flow where the commit happens (a top-up). Used
	 * only without `onCommit`. With neither, the review offers no commit, only Close.
	 */
	commitHref?: string | null;
	/** Default "Cancel" ("Close" with no commit). */
	cancelLabel?: string;
	/** Fired whenever the review opens or closes, however it was closed. */
	onVisibleChange?: (visible: boolean) => void;
	class?: string;
}
// #endregion

/**
 * CommitReview — the review step before money moves (DESIGN_SYSTEM §B.8): the figure, the facts that
 * bind it, what committing does, then ONE tier-1 commit with a text Cancel before it.
 *
 * `ConfirmDialog` cannot host it — its accept is a severity, never the amber pill, and it routes every
 * dismissal to reject (Decision #157 (o)). This is `role="alertdialog"` (the reader is about to move
 * money); focus opens on the action group, so Cancel is the first stop, never the commit. While the
 * commit is in flight nothing dismisses it — no Escape, no scrim, no × — and a refusal is said inside
 * the review, assertively, with the commit offered again. Below `--bp-md` it docks as a bottom sheet.
 */
export function CommitReview(props: CommitReviewProps): JSX.Element {
	const isMobile = useIsMobile();
	const busy = useSignal(false);
	const error = useSignal<string | null>(null);
	const actionsRef = useRef<HTMLDivElement>(null);

	const mode: CommitReviewMode = props.onCommit ? "action" : props.commitHref ? "link" : "none";
	const sending = busy.value;
	const actions = commitReviewActions({
		mode,
		commitLabel: props.commitLabel ?? "Confirm",
		commitFigure: props.commitFigure,
		cancelLabel: props.cancelLabel,
		busy: sending,
		failed: error.value !== null,
	});
	const dialog = commitReviewDialog(sending);
	/** The controls as last rendered, read once a refusal has re-rendered the group. */
	const renderedActions = useRef(actions);
	renderedActions.current = actions;

	/**
	 * After a refusal, put focus back inside the review (on "Try again", or the lone Close) — unless the
	 * reader has already moved it somewhere in the review. Deferred a task, so it runs after the
	 * refusal's re-render has enabled the controls again.
	 */
	const refocus = () => {
		setTimeout(() => {
			const group = actionsRef.current;
			if (!group) return;
			const active = document.activeElement;
			const review = group.closest("[role=alertdialog]");
			if (active && active !== document.body && review?.contains(active)) return;
			const controls = group.querySelectorAll<HTMLElement>(":scope > button, :scope > a");
			controls[commitReviewRefocusIndex(renderedActions.current)]?.focus();
		}, 0);
	};

	const close = () => {
		props.visible.value = false;
		error.value = null;
		props.onVisibleChange?.(false);
	};

	const commit = async () => {
		if (!props.onCommit || busy.peek()) return;
		busy.value = true;
		error.value = null;
		const refusal = await props.onCommit().catch(() =>
			"We couldn't confirm this went through. Check the balance before trying again."
		);
		busy.value = false;
		if (refusal === null) {
			close();
			return;
		}
		error.value = refusal;
		refocus();
	};

	const footer = (
		<div class="ui-commit-review__actions" ref={actionsRef}>
			{actions.map((action) =>
				action.element === "link"
					? (
						<a
							key={action.role}
							class={commitLinkClass(action)}
							href={props.commitHref ?? undefined}
						>
							<span class="ui-button__label">
								<CommitLabel label={action.label} figure={action.figure} />
							</span>
						</a>
					)
					: action.role === "commit"
					? (
						<Button
							key={action.role}
							severity="accent"
							variant="filled"
							rounded
							loading={action.loading}
							disabled={action.disabled}
							onClick={() => void commit()}
						>
							<CommitLabel label={action.label} figure={action.figure} />
						</Button>
					)
					: (
						<Button
							key={action.role}
							variant="text"
							label={action.label}
							disabled={action.disabled}
							onClick={close}
						/>
					)
			)}
		</div>
	);

	return (
		<Dialog
			visible={props.visible}
			header={props.title}
			footer={footer}
			position={isMobile ? "bottom" : "center"}
			width="var(--overlay-w-sm)"
			role={dialog.role}
			initialFocusRef={dialog.initialFocus === "actions" ? actionsRef : undefined}
			closable={dialog.closable}
			closeOnEscape={dialog.closeOnEscape}
			dismissableMask={dialog.dismissableMask}
			class={props.class}
			onVisibleChange={(next) => {
				if (!next) error.value = null;
				props.onVisibleChange?.(next);
			}}
		>
			<CommitReviewBody
				total={props.total}
				rows={props.rows}
				consequence={props.consequence}
				notice={error.value
					? (
						<InlineNotice
							class="ui-commit-review__notice"
							align="start"
							assertive
							icon={<Icon name="warning" />}
							text={error.value}
						/>
					)
					: null}
			/>
		</Dialog>
	);
}
