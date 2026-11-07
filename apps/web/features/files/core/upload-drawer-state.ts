import { computed, signal } from "@preact/signals";
import { uploadQueue } from "./files-state.ts";
import { summariseUploads } from "./upload-progress.ts";

/**
 * upload-drawer-state — whether the upload queue is on screen, and what the footer reports about it.
 *
 * One boolean, and it lives in a module rather than in a prop for a reason that was MEASURED rather
 * than assumed. `FilesFooterRig` and `UploadDrawer` are both islands, and the rig renders the drawer:
 * passing the open state down as a `Signal<boolean>` prop crosses an island boundary, and the two
 * halves then hold two DIFFERENT signal instances — the drawer opened itself, while the rig's copy
 * stayed `false` and its `aria-expanded` reported a closed drawer that was plainly on screen. The
 * queue survived because it was already shared this way; the open flag was not.
 *
 * So this follows the same rule every other cross-island pair in the codebase follows
 * (`files-state.ts`, `board-state.ts`, `inbox-state.ts`): **two hydration roots share a module, never
 * a prop.** A module-level signal is one instance per client bundle graph, which is exactly the scope
 * a browser tab wants.
 *
 * **Module-level means per-PROCESS on the server.** Nothing in the SSR path may write it — a server
 * write would leak one request's state into the next person's first paint. It is only ever written
 * from the browser, by the footer's upload widget and the drawer's own dismissal.
 */

// #region Open state
/**
 * Whether the upload queue drawer is showing.
 *
 * Raised only by a person: the footer's upload widget opens it, and a drop never does (the widget
 * reports the batch in place). Closing the drawer never stops the work.
 */
export const uploadDrawerOpen = signal(false);

/** Show the queue. Idempotent, and deliberately without a matching close: the drawer owns dismissal. */
export function openUploadDrawer(): void {
	uploadDrawerOpen.value = true;
}
// #endregion

// #region Footer report
/**
 * The ids a closed footer report covered. Everything else in the queue is the report the widget is
 * showing, so the next drop after a report closes counts from one. Retired rows stay in the drawer:
 * retiring ends the report, not the record.
 */
export const retiredUploads = signal<ReadonlySet<string>>(new Set());

/** The tasks the footer report covers, oldest first. */
export const reportedUploads = computed(() =>
	uploadQueue.value.filter((task) => !retiredUploads.value.has(task.id))
);

/** The footer report, counted (`core/upload-progress.ts`). `idle` hides the widget. */
export const uploadReport = computed(() => summariseUploads(reportedUploads.value));

/** Close the footer report: every id it covers is retired. */
export function retireUploadReport(): void {
	const next = new Set(retiredUploads.peek());
	for (const task of reportedUploads.peek()) next.add(task.id);
	retiredUploads.value = next;
}
// #endregion
