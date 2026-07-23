import { signal } from "@preact/signals";

/**
 * submission-workspace — the cross-island bridge between the Submissions explorer BODY (the
 * `SubmissionExplorer` island, which owns the tree, the crumb-bar actions, and every modal + panel) and
 * its middle-nav FOOTER band (the `SubmissionViewControlRig` island, a separate hydration boundary that
 * owns the zoom rig + the Tasks-panel toggle). They coordinate exactly like the File Explorer's
 * footer↔body `zoom` — through these module-level signals: the body publishes whether a Tasks panel is
 * available for the current stage/ticket ({@link tasksAvailable}); the footer reads it to show/enable the
 * toggle and flips {@link tasksPanelOpen}; the body watches that to mount the Tasks drawer. Reset on
 * unmount so a later navigation starts clean.
 */

// #region Signals
/** Whether the Tasks drawer/panel is open (footer toggle ↔ body panel). */
export const tasksPanelOpen = signal<boolean>(false);

/**
 * Whether the client has defined stage/ticket tasks for the current view — the footer's Tasks toggle is
 * shown only then (root task §6). Published by the body as the effective `hasTasks` resolves.
 */
export const tasksAvailable = signal<boolean>(false);
// #endregion

// #region Actions
/** Toggle the Tasks drawer (the footer button). No-op unless tasks are available. */
export function toggleTasksPanel(): void {
	if (tasksAvailable.value) tasksPanelOpen.value = !tasksPanelOpen.value;
}

/** Close the Tasks drawer (the panel's own close control / a navigation away). */
export function closeTasksPanel(): void {
	tasksPanelOpen.value = false;
}

/** Publish whether tasks are available; auto-closes the panel when they become unavailable. */
export function setTasksAvailable(available: boolean): void {
	tasksAvailable.value = available;
	if (!available) tasksPanelOpen.value = false;
}
// #endregion
