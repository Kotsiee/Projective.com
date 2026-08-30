import { page } from "fresh";
import { asAuthenticatedContext } from "@projective/types/auth";
import { define } from "@web/utils/state.ts";
import { ProjectShowcaseScreen } from "@features/projects/components/ProjectShowcaseScreen.tsx";
import { resolveProjectShowcase } from "@features/projects/core/showcase-ssr.ts";
import { readActor } from "@web/utils/api-session.ts";

/**
 * `/projects/[projectId]` — the Project **Preview** (root brief §Part 1.1). Thin controller: resolve the
 * showcase projection straight from the fat service (no HTTP hop), set SEO, then hand off to the
 * {@link ProjectShowcaseScreen} — which renders the SAME layout as `/view/[id]?type=projects` and adds
 * the role-appropriate CTA (Apply for a freelancer, Edit for the owner). The middle-nav Preview/Edit
 * header + the untouched Project Details sidebar are resolved separately by the `(dashboard)` layout.
 */
export const handler = define.handlers({
	async GET(ctx) {
		const { showcase, detail } = await resolveProjectShowcase(
			ctx.params.projectId,
			asAuthenticatedContext(ctx.state.userContext),
			readActor(ctx),
		);
		ctx.state.title = detail ? `${detail.title} · Projective` : "Project · Projective";
		return page({ showcase, slug: ctx.params.projectId });
	},
});

export default define.page<typeof handler>(function ProjectDetailPage({ data }) {
	return <ProjectShowcaseScreen showcase={data.showcase} slug={data.slug} />;
});
