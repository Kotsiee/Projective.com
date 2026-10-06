import { page } from "fresh";
import { define } from "@web/utils/state.ts";
import { readActor } from "@web/utils/api-session.ts";
import { landingFor, type ProjectStatus, type ProjectWorkspace } from "@projective/types/projects";
import { ProjectOverviewScreen } from "@features/projects/components/overview/ProjectOverviewScreen.tsx";
import { resolveProjectWorkspace } from "@features/projects/core/overview-ssr.ts";
import {
	landingHref,
	resolveProjectAccess,
	seeOther,
} from "@features/projects/core/project-access.ts";
import { projectsNoticeHref } from "@features/projects/core/project-notice.ts";
import { STATUS_LABEL } from "@features/projects/core/portfolio-model.ts";

/**
 * `/projects/[slug]` — the engagement's **Overview**, and the dispatcher that decides who sees it
 * (Decision #144, which amends #84).
 *
 * The root address is the command center for the people working on the engagement: what needs me,
 * where each stage stands, the rooms, the people. Who reaches it is one pure rule over two server
 * facts — the viewer's access and the project's lifecycle (`landingFor`):
 *
 *   • **Owner** on a published engagement, and **every participant** in every status → the Overview,
 *     drawn for whichever of the two they are.
 *   • **Owner on a draft** → `/projects/[slug]/details`. Nothing is staffed or running, so there is
 *     nothing to command, and the configuration is the page; sending the owner there gives the form
 *     one address instead of two.
 *   • **Prospect** → the public listing (`/view/[slug]?type=projects`), or "does not exist" for a
 *     draft. In practice the project middleware has already sent them there; the rule is total so this
 *     page never needs to know that.
 *
 * The configuration used to BE this page, which put an operational engagement's owner on a form of
 * frozen fields (#89's locks) under a header reporting it "86% complete". The setup surface is
 * unchanged; it lives at `/details`, and `/edit` and `/settings` 308 there.
 *
 * Every exit is a 303 returned from `define.handlers` — never a 308, because each depends on who is
 * asking and what state the engagement is in (a cached "this draft goes to its details" would outlive
 * the publish), and never from the page component, where a `Response` is dead code (Decision #61).
 *
 * `projectSlug` is an OPAQUE address (Decision #88), handed straight to the resolvers.
 */

interface OverviewData {
	workspace: ProjectWorkspace | null;
	slug: string;
}

export const handler = define.handlers({
	async GET(ctx) {
		const slug = ctx.params.projectSlug;
		// Memoised by the project middleware for this request, so this is a read-back, not a second read.
		const resolved = await resolveProjectAccess(ctx, slug);
		if (!resolved) return seeOther(projectsNoticeHref("project-not-found"));

		const landing = landingFor(resolved.access, resolved.status);
		if (landing.kind !== "overview") {
			return seeOther(landingHref(landing, slug) ?? projectsNoticeHref("project-not-found"));
		}

		ctx.state.title = `${resolved.title} · Projective`;
		const { workspace } = await resolveProjectWorkspace(slug, readActor(ctx), landing.viewer);
		const shown = workspace && resolved.simulated
			? withStatus(workspace, resolved.status)
			: workspace;
		// Kept for the footer band's rig, which the layout renders after this handler returns.
		if (shown) ctx.state.projectWorkspace = shown;
		const data: OverviewData = { workspace: shown, slug };
		return page(data);
	},
});

/**
 * The workspace restated under a SIMULATED status (development only), so the page's status mark and
 * notices follow the Dev Context Switcher the same way the dispatch above did.
 */
function withStatus(workspace: ProjectWorkspace, status: ProjectStatus): ProjectWorkspace {
	return { ...workspace, hero: { ...workspace.hero, status, statusLabel: STATUS_LABEL[status] } };
}

export default define.page<typeof handler>(function ProjectOverviewPage({ data }) {
	return <ProjectOverviewScreen workspace={data.workspace} slug={data.slug} />;
});
