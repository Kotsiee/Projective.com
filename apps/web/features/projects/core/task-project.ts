import { isTaskProject, type ProjectDetail } from "../types/projects-types.ts";
import { channelHref } from "./chat-context.ts";

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

// #region The one conversation
/** A Task's single conversation — the one room its lane and view links send people to. */
export interface TaskDiscussion {
	/**
	 * The routed channel segment: the stage's `stg-…` slug when the room is the stage's, else the
	 * general channel's own id. What a link carries, never what a read is keyed on.
	 */
	ref: string;
	/** `/projects/{slug}/{ref}` — the room's Chat view. */
	href: string;
	/** Unseen activity in the room (§D.1 — a dot, never a count). */
	unread: boolean;
}

/**
 * The room a Task's discussion lives in, or `null` when the engagement has none a link can reach.
 *
 * The stage's shared room first, because it is the room a Task actually has: `create_project` opens
 * the implicit stage's `stage_all` room in the same transaction and opens no project-wide one, and it
 * is also the room whose header carries the Tasks and Submissions views — so the discussion and the
 * work it is about are one place. A general channel is the fallback for an engagement whose stage room
 * was never provisioned. With neither, there is no link to offer: a Discussion entry that led nowhere
 * would be a control that renders and reaches nothing (root CLAUDE.md §3 gate 11).
 *
 * The stage is the FIRST by order rather than the only one, so a legacy row that somehow holds two is
 * answered deterministically instead of by array position.
 */
export function taskDiscussionOf(detail: ProjectDetail): TaskDiscussion | null {
	const stage = [...detail.channels.stages].sort((a, b) => a.order - b.order)[0];
	if (stage) {
		return {
			ref: stage.slug,
			href: channelHref(detail.slug, stage.slug),
			unread: stage.channel.unread,
		};
	}
	const general = detail.channels.general[0];
	if (general) {
		return { ref: general.id, href: channelHref(detail.slug, general.id), unread: general.unread };
	}
	return null;
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
