import { asAuthenticatedContext } from "@projective/types/auth";
import { readActor, type SessionContext } from "@web/utils/api-session.ts";
import { resolveProjectDetail } from "./detail-ssr.ts";
import { isTaskDetail } from "./task-project.ts";

/**
 * The redirect for a view a Task does not have — `timeline` or `calendar` (`TASK_ABSENT_VIEWS`) — or
 * `null` when the engagement is not a Task and the view should render.
 *
 * The tab and the view link that lead to these views are absent on a Task, so arriving here is a typed
 * address, an old bookmark, or a link minted before the engagement became a Task (its type can change
 * in settings). A 404 would be a dead end beside a perfectly good destination, so the answer is the page
 * the view would have been a view OF — the engagement for a project-level view, the room for a
 * channel-level one. `303`, because that answer is a different resource reached with `GET`, and because
 * a Task converted back to a pipeline has these views again, so the redirect must not be cached as
 * permanent.
 *
 * Server-only (it reaches `@server/services` through {@link resolveProjectDetail}), and returned from
 * `define.handlers` by each route rather than from its page component: a `Response` returned by a
 * `define.page` component is dead code (root CLAUDE.md §8 Decision #61). A slug that resolves to
 * nothing is left to the route, which already renders its own miss.
 */
export async function taskAbsentViewRedirect(
	ctx: SessionContext,
	projectSlug: string,
	destination: string,
): Promise<Response | null> {
	const { detail } = await resolveProjectDetail(
		projectSlug,
		asAuthenticatedContext(ctx.state.userContext),
		readActor(ctx),
	);
	if (!detail || !isTaskDetail(detail)) return null;
	return new Response(null, { status: 303, headers: { location: destination } });
}
