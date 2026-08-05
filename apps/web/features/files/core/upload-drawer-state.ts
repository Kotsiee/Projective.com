import { signal } from "@preact/signals";

/**
 * upload-drawer-state — whether the upload queue is on screen.
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
 * from the browser: by the drawer when the queue gains work, and by the rig's queue affordance.
 */

// #region Open state
/**
 * Whether the upload queue drawer is showing.
 *
 * Two owners on purpose. The drawer raises it when work arrives, because a queue that starts
 * invisibly is a queue nobody can cancel; the rig's affordance raises it again afterwards, because a
 * person who closed the report must be able to get back to it — and closing the report must never
 * stop the work.
 */
export const uploadDrawerOpen = signal(false);

/** Show the queue. Idempotent, and deliberately without a matching close: the drawer owns dismissal. */
export function openUploadDrawer(): void {
	uploadDrawerOpen.value = true;
}
// #endregion
