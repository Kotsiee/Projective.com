import { signal } from "@preact/signals";

/**
 * Submissions review-trigger state — the cross-island bridge between the middle-nav footer's **Review
 * Submission** button (in the `SubmissionViewControlRig` island) and the review workspace modal (owned
 * by the `SubmissionExplorer` island). They are separate hydration boundaries, so — exactly like the
 * File Explorer's footer↔body `zoom` coordination — they coordinate through these module-level signals:
 * the explorer publishes whether a reviewable submission is currently in view ({@link canReview}), the
 * footer button reads it to enable/disable + calls {@link requestReview} on click, and the explorer
 * watches {@link reviewOpen} to mount the modal. Reset on unmount so a later navigation starts clean.
 */

// #region Signals
/** Whether the review workspace modal is open. The footer button opens it; the modal + Esc close it. */
export const reviewOpen = signal<boolean>(false);

/**
 * Whether an active, reviewable submission unit is currently in view AND the viewer is the client — the
 * footer's Review Submission button is shown/enabled only then. Published by the explorer island as the
 * tree path + viewer role resolve.
 */
export const canReview = signal<boolean>(false);

/** A short human label for the active unit (the footer button's tooltip / a11y hint). */
export const reviewLabel = signal<string>("");
// #endregion

// #region Actions
/** Open the review workspace modal (the footer button). No-op unless a reviewable unit is in view. */
export function requestReview(): void {
	if (canReview.value) reviewOpen.value = true;
}

/** Close the review workspace modal. */
export function closeReview(): void {
	reviewOpen.value = false;
}

/** Publish the current reviewable state (the explorer island calls this as its path/role resolve). */
export function setReviewable(enabled: boolean, label: string): void {
	canReview.value = enabled;
	reviewLabel.value = label;
	if (!enabled) reviewOpen.value = false;
}
// #endregion
