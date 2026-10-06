import { z } from "zod";

/**
 * projects.nav-activity — what changed in each of an engagement's lane views since the viewer last
 * opened it (`projects.get_nav_activity`), and the mark that records an opening
 * (`projects.mark_view_seen`, table `projects.view_reads`).
 *
 * Everything here is per viewer: the database computes it under the caller's own RLS, so an owner and
 * a freelancer looking at the same engagement get different answers by construction.
 */

// #region Views
/** The lane views that carry an activity mark — the `projects.view_reads.lane_view` CHECK. */
export const ProjectNavView = z.enum([
	"overview",
	"discussion",
	"board",
	"timeline",
	"files",
	"submissions",
	"members",
]);
export type ProjectNavView = z.infer<typeof ProjectNavView>;

/** The Overview regions an edit can land in — each one the Overview highlights on arrival. */
export const OverviewChange = z.enum(["details", "status", "stages"]);
export type OverviewChange = z.infer<typeof OverviewChange>;

/** A Board mark's tone: a new card or stage, or cards that changed lane. */
export const BoardActivityTone = z.enum(["new", "moved"]);
export type BoardActivityTone = z.infer<typeof BoardActivityTone>;

/** A Timeline mark's tone: a deadline inside 48 hours, or a recorded progress shift. */
export const TimelineActivityTone = z.enum(["deadline", "update"]);
export type TimelineActivityTone = z.infer<typeof TimelineActivityTone>;

/** The highest count a lane draws as a figure; anything above it reads "9+". */
export const NAV_COUNT_DISPLAY_MAX = 9;
// #endregion

// #region Activity
const capped = (max: number) => z.number().int().min(0).max(max);

/** One viewer's activity across the lane views of one engagement. */
export const ProjectNavActivitySchema = z.object({
	overview: z.object({ changes: z.array(OverviewChange).max(3) }),
	/** Unread messages by other people in the discussion room, capped at 10 ("9+"). */
	discussion: z.object({ unread: capped(10) }),
	board: z.object({ tone: BoardActivityTone.nullable() }),
	timeline: z.object({ tone: TimelineActivityTone.nullable() }),
	/** Whether the project owner shared a file the viewer has not seen. */
	files: z.object({ fresh: z.boolean() }),
	/** Submissions awaiting the viewer: new work for a reviewer, new verdicts for a submitter. */
	submissions: z.object({ count: capped(100) }),
	/** Arrivals, plus — for the staffing side — requests and invitation outcomes. */
	members: z.object({ count: capped(100) }),
});
export type ProjectNavActivity = z.infer<typeof ProjectNavActivitySchema>;

/** The answer for a viewer with nothing waiting anywhere. */
export const QUIET_NAV_ACTIVITY: ProjectNavActivity = {
	overview: { changes: [] },
	discussion: { unread: 0 },
	board: { tone: null },
	timeline: { tone: null },
	files: { fresh: false },
	submissions: { count: 0 },
	members: { count: 0 },
};

/** A count as the lane prints it: the figure up to nine, "9+" beyond. */
export function navCountLabel(count: number): string {
	return count > NAV_COUNT_DISPLAY_MAX ? `${NAV_COUNT_DISPLAY_MAX}+` : String(count);
}
// #endregion

// #region Mark seen
/** `POST /api/projects/nav-seen` — the viewer opened one lane view of one engagement. */
export const MarkViewSeenInputSchema = z.object({
	projectId: z.string().trim().min(1).max(120),
	view: ProjectNavView,
});
export type MarkViewSeenInput = z.infer<typeof MarkViewSeenInputSchema>;

/** What a recorded opening answers with. */
export const MarkViewSeenResultSchema = z.object({
	view: ProjectNavView,
	seenAt: z.string(),
});
export type MarkViewSeenResult = z.infer<typeof MarkViewSeenResultSchema>;
// #endregion
