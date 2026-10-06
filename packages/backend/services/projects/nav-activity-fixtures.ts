import {
	discussionOf,
	type MarkViewSeenResult,
	type ProjectDetail,
	type ProjectNavActivity,
	type ProjectNavView,
	QUIET_NAV_ACTIVITY,
} from "@projective/types/projects";

/**
 * nav-activity-fixtures — the lane's activity marks on the fixture path (`deno task dev:mock`).
 *
 * The marks are read off facts the fixture detail already states, never invented beside them: the
 * discussion room's unread flag, a stage's `new_ticket` / `revision_requested` / `stage_invite`
 * activity. Opening a view is remembered per viewer and engagement for the life of the process, so a
 * mark clears on a visit exactly as it does against the database and stays cleared until a restart.
 */

// #region Seen store
const seen = new Map<string, Set<ProjectNavView>>();

function seenKey(userId: string, slug: string): string {
	return `${userId}:${slug}`;
}

/** Remember that `userId` opened `view` on `slug`. */
export function recordFixtureSeen(
	userId: string,
	slug: string,
	view: ProjectNavView,
	nowMs: number = Date.now(),
): MarkViewSeenResult {
	const key = seenKey(userId, slug);
	const views = seen.get(key) ?? new Set<ProjectNavView>();
	views.add(view);
	seen.set(key, views);
	return { view, seenAt: new Date(nowMs).toISOString() };
}
// #endregion

// #region Projection
/** The fixture detail's activity as the lane marks it, minus every view `userId` has opened. */
export function fixtureNavActivity(detail: ProjectDetail, userId: string): ProjectNavActivity {
	const room = discussionOf(detail);
	const unread = room?.kind === "stage" ? room.stage.channel.unread : room?.channel.unread ?? false;
	const has = (activity: string) => detail.channels.stages.some((s) => s.activity === activity);
	const participant = !detail.viewerIsClient;

	const activity: ProjectNavActivity = {
		overview: { changes: participant && has("new_ticket") ? ["stages"] : [] },
		discussion: { unread: unread ? 3 : 0 },
		board: { tone: has("new_ticket") ? "new" : null },
		timeline: { tone: has("revision_requested") ? "update" : null },
		files: { fresh: participant && unread },
		submissions: { count: has("revision_requested") ? 1 : 0 },
		members: { count: has("stage_invite") ? 1 : 0 },
	};

	const opened = seen.get(seenKey(userId, detail.slug));
	if (!opened) return activity;
	const quieted = { ...activity };
	for (const view of opened) {
		Object.assign(quieted, { [view]: QUIET_NAV_ACTIVITY[view] });
	}
	return quieted;
}
// #endregion
