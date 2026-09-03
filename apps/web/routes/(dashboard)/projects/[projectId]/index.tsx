import { page } from "fresh";
import { define } from "@web/utils/state.ts";
import { readActor } from "@web/utils/api-session.ts";
import { ProjectSetupScreen } from "@features/projects/components/setup/ProjectSetupScreen.tsx";
import { ProjectMemberDashboard } from "@features/projects/components/dashboard/ProjectMemberDashboard.tsx";
import { resolveProjectSetup } from "@features/projects/core/setup-ssr.ts";
import { resolveProjectOverview } from "@features/projects/core/overview-ssr.ts";
import { resolveProjectShowcase } from "@features/projects/core/showcase-ssr.ts";
import { asAuthenticatedContext } from "@projective/types/auth";
import type { ProjectOverview, ProjectSetup } from "@features/projects/types/projects-types.ts";

/**
 * `/projects/[projectId]` — the ROLE DISPATCHER for an engagement.
 *
 * One URL, two surfaces, chosen by which side of the engagement the viewer is on:
 *
 *   • **Client / owner** → the setup surface. The engagement is a thing they are still assembling, so
 *     the page is the configuration form, its progress ladder rides in the middle-nav header band and
 *     its actions in the footer band.
 *   • **Everyone else** → the member dashboard. The engagement is work they are doing, so the page is
 *     what it wants from them: recent activity, unread rooms, their assignments, their earnings.
 *
 * `viewerIsClient` is re-derived SERVER-side from the acting context and never trusted from the
 * client (root CLAUDE.md §6), so the dispatch is authoritative rather than cosmetic.
 *
 * The two branches resolve DIFFERENT reads and only the branch that runs pays for one. Resolving both
 * on every request would double the cost of a page where one of the two answers is always discarded —
 * and the setup read reaches columns a non-owner has no business having assembled for them at all.
 *
 * The public showcase this route used to render lives on at `/view/[id]?type=projects`, which is where
 * a stranger evaluating the engagement belongs; `/projects/*` is the working surface for people
 * already inside it.
 *
 * `projectId` is an OPAQUE address, not a parsed one. Quick-Init sends a newly minted draft here by
 * its row uuid — a uuid cannot collide, cannot be squatted, and survives the first rename, which a
 * title-derived slug does not — while every link minted before that carries a slug. Both are handed
 * straight through to resolvers that accept either, so nothing here needs to know which it received.
 */
export const handler = define.handlers({
	async GET(ctx) {
		const projectId = ctx.params.projectId;
		const actor = readActor(ctx);
		// The cheapest question that decides the branch. `resolveProjectShowcase` already exists and is
		// what the header and footer slots resolve for the same request, so its read is warm.
		const { detail, viewerIsClient } = await resolveProjectShowcase(
			projectId,
			asAuthenticatedContext(ctx.state.userContext),
			actor,
		);
		ctx.state.title = detail ? `${detail.title} · Projective` : "Project · Projective";

		if (viewerIsClient) {
			const { setup } = await resolveProjectSetup(projectId, actor);
			return page({ role: "owner" as const, setup, overview: null, projectId });
		}
		const { overview } = await resolveProjectOverview(projectId, actor);
		return page({ role: "member" as const, setup: null, overview, projectId });
	},
});

export default define.page<typeof handler>(function ProjectEngagementPage({ data }) {
	const { role, projectId } = data;
	return role === "owner"
		? <ProjectSetupScreen setup={data.setup as ProjectSetup | null} slug={projectId} />
		: (
			<ProjectMemberDashboard
				overview={data.overview as ProjectOverview | null}
				slug={projectId}
			/>
		);
});
