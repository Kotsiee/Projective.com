import { isTaskProject, type ProjectDetail } from "../types/projects-types.ts";

/**
 * task-project — the rules behind a Task engagement's simplified chrome.
 *
 * A Task is one deliverable for one price (`one_off` + `single_task`), held by
 * `fn_enforce_structure_variation` to exactly one stage and one ticket. Everything a multi-stage run
 * needs a navigator for — a stage tree to switch between, a Gantt of how the stages overlap, a calendar
 * of their windows — has nothing to navigate on a Task, so its chrome is simpler, and these are the
 * rules every surface that simplifies itself reads: the lane, the view links, the channel header and
 * the four route guards.
 *
 * A Task's one conversation is no longer a rule of its own: it is the engagement's discussion,
 * `/projects/{slug}/discussion`, which every archetype has (`discussionLinkOf` in `chat-context.ts`,
 * over the shared `discussionOf` rule). What makes a Task's different is only WHICH room the word
 * opens — its stage's — and that is decided where the room is resolved, not here.
 *
 * Pure and DOM-free, and deliberately clear of `channel-view.ts` (which reaches the dev seam and so
 * cannot be imported by a plain `deno test`), so the rules are unit-testable where they are written.
 *
 * @module
 */

// #region Classification
/** Whether an engagement is a Task — `isTaskProject` over the two stored axes. */
export function isTaskDetail(detail: Pick<ProjectDetail, "format" | "structure">): boolean {
	return isTaskProject(detail.format, detail.structure);
}
// #endregion

// #region Views a Task does not have
/**
 * The project- and channel-level view segments a Task has no use for: `timeline` (a Gantt of one bar)
 * and `calendar` (the windows of stages it does not have). Read by the route guards, which answer a
 * request for either with the page it would have been a view of, and by the tab filter, so a tab and
 * the route behind it cannot disagree about whether the view exists.
 */
export const TASK_ABSENT_VIEWS: ReadonlySet<string> = new Set(["timeline", "calendar"]);
// #endregion
