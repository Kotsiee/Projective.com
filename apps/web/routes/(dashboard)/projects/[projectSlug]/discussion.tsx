import { page } from "fresh";
import { define } from "@web/utils/state.ts";
import { readActor } from "@web/utils/api-session.ts";
import { asAuthenticatedContext } from "@projective/types/auth";
import { DISCUSSION_REF, discussionOf } from "@projective/types/projects";
import { resolveProjectDetail } from "@web/features/projects/core/detail-ssr.ts";
import { resolveMessageFeed } from "@web/features/projects/core/messages-ssr.ts";
import { projectsNoticeHref } from "@web/features/projects/core/project-notice.ts";
import ChatFeed from "@web/features/projects/islands/ChatFeed.island.tsx";
import type { MessagePage } from "@web/features/projects/types/projects-types.ts";

/**
 * Discussion — the engagement's one primary conversation (`/projects/[projectSlug]/discussion`), the
 * first link in the lane on every archetype.
 *
 * The address is fixed; the ROOM it opens follows the engagement's type (`discussionOf`, the rule the
 * live resolver and the fixtures share):
 *
 *   • a **Task** binds its root stage's shared room — the room `create_project` provisions with the
 *     stage, and the one carrying the Tasks and Submissions views;
 *   • a **one-off, pipeline or session** binds its project-wide room
 *     (`comms.project_channels.visibility = 'project_all'`).
 *
 * The page is the room's Chat view. Every read and write below it — this feed, the composer, the
 * header's tabs (`/discussion/files`, `/discussion/tasks`, …, served by the `[channelId]` routes) —
 * carries the word `discussion` rather than the room's key, and the server resolves it to the room
 * (`resolveChannelRef`). So the address the lane links is the address every tab and every posted
 * message is made against, and none of them has to know which room it is.
 *
 * ## Two misses, answered in `define.handlers`
 *
 * A `Response` from a `define.page` component is dead code (Decision #61), so both exits are here:
 *
 *   • **No such engagement** → `303` to `/projects` with the project-not-found flash, exactly as the
 *     engagement's own page answers it.
 *   • **An engagement with no discussion room** → `303` to the engagement itself. The lane offers no
 *     Discussion link in that state, so arriving is a typed address; the room does not exist, and an
 *     empty feed under a "Discussion" header would claim a conversation that has nowhere to happen.
 *     On the live path that is a project created before creation provisioned its project-wide room.
 */

// #region Route data
interface DiscussionData {
	/** The routed project slug — the feed's project key. */
	projectId: string;
	/** The latest page of the room, or `null` when the read came back empty. */
	initial: MessagePage | null;
}
// #endregion

export const handler = define.handlers({
	async GET(ctx) {
		const projectId = ctx.params.projectSlug;
		const actor = readActor(ctx);
		const { detail } = await resolveProjectDetail(
			projectId,
			asAuthenticatedContext(ctx.state.userContext),
			actor,
		);

		if (!detail) {
			return new Response(null, {
				status: 303,
				headers: { location: projectsNoticeHref("project-not-found") },
			});
		}
		if (!discussionOf(detail)) {
			return new Response(null, {
				status: 303,
				headers: { location: `/projects/${encodeURIComponent(projectId)}` },
			});
		}

		ctx.state.title = `Discussion · ${detail.title} · Projective`;
		const { page: initial } = await resolveMessageFeed(projectId, DISCUSSION_REF, actor);
		const data: DiscussionData = { projectId, initial };
		return page(data);
	},
});

export default define.page<typeof handler>(function DiscussionPage({ data }) {
	// The same body chrome the `[channelId]` layout gives every other room's Chat view — the header and
	// the composer are the frame's bands, resolved by the dashboard layout from this URL.
	return (
		<div class="chan-view">
			<ChatFeed projectId={data.projectId} channelId={DISCUSSION_REF} initial={data.initial} />
		</div>
	);
});
