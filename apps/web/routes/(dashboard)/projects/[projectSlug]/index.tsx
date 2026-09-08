import { page } from "fresh";
import { define } from "@web/utils/state.ts";
import { readActor } from "@web/utils/api-session.ts";
import { ProjectSetupScreen } from "@features/projects/components/setup/ProjectSetupScreen.tsx";
import { ProjectMemberDashboard } from "@features/projects/components/dashboard/ProjectMemberDashboard.tsx";
import { resolveProjectSetup } from "@features/projects/core/setup-ssr.ts";
import { resolveProjectOverview } from "@features/projects/core/overview-ssr.ts";
import { resolveProjectShowcase } from "@features/projects/core/showcase-ssr.ts";
import { projectsNoticeHref } from "@features/projects/core/project-notice.ts";
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
 * `projectSlug` is an OPAQUE address, not a parsed one: the minted, immutable `prj-…` slug (root
 * CLAUDE.md §8 Decision #88), handed straight through to a resolver that does the matching. Nothing
 * here inspects it — including on the way out, which is why a malformed address and a real one that
 * matched nothing take the same exit.
 *
 * ## A project that is not there
 *
 * The showcase read is also the existence check, so the miss is caught before either branch has
 * chosen a surface, and the request ends in a `303` to `/projects` carrying a `?notice=` flash that
 * the list turns into one toast (`core/project-notice.ts`). Two things follow from doing it here
 * rather than in the body:
 *
 *   • **Nothing half-built is ever sent.** The alternative — render, notice the `null`, redirect from
 *     the client — has to paint something in order to run, and what it would paint is a page missing
 *     the engagement it is entirely about. The server already has the answer before the first byte.
 *   • **The wasted second read goes away.** A miss used to fall through with `viewerIsClient: false`
 *     into the member branch and pay for an overview read that could only come back empty too.
 *
 * `detail` being `null` covers a project that never existed AND one this viewer may not see, and the
 * flash says "does not exist" for both deliberately — see `project-notice.ts`. The narrower case of a
 * project that resolved but whose SETUP read came back empty is left alone: the engagement is there,
 * so telling the owner it is not would be a lie about a partial failure, and the in-body miss state
 * still catches it.
 */
export const handler = define.handlers({
	async GET(ctx) {
		const projectId = ctx.params.projectSlug;
		const actor = readActor(ctx);
		// The cheapest question that decides the branch. `resolveProjectShowcase` already exists and is
		// what the header and footer slots resolve for the same request, so its read is warm.
		const { detail, viewerIsClient } = await resolveProjectShowcase(
			projectId,
			asAuthenticatedContext(ctx.state.userContext),
			actor,
		);

		// A miss ends the request here, before the branch below picks a surface to render for a project
		// that is not there. Returned from `define.handlers`, never from the page component: a
		// `Response` returned by a `define.page` component is dead code and the body renders anyway
		// (root CLAUDE.md §8 Decision #61).
		if (!detail) {
			return new Response(null, {
				status: 303,
				headers: { location: projectsNoticeHref("project-not-found") },
			});
		}
		ctx.state.title = `${detail.title} · Projective`;

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
