import { page } from "fresh";
import { asAuthenticatedContext } from "@projective/types/auth";
import { define } from "@web/utils/state.ts";
import ProjectEditor from "@features/projects/islands/ProjectEditor.island.tsx";
import { resolveProjectShowcase } from "@features/projects/core/showcase-ssr.ts";

/**
 * `/projects/[projectId]/edit` — the CLIENT/owner's project editor (root brief §Part 1.1). Thin
 * controller with a hard ROLE GUARD: the editor is client-only, so a non-owner (or a slug that resolves
 * to nothing) is bounced to the Preview (`/projects/[id]`) — the same route the hidden Edit tab points
 * at. `viewerIsClient` is re-derived server-side from the acting context (never trusted from the client,
 * root CLAUDE.md §6), so the redirect is authoritative even though the Edit tab is also hidden in the UI.
 * The real stage names/order seed the editor; the rest of each stage starts blank to be filled in.
 */
export const handler = define.handlers({
	GET(ctx) {
		const slug = ctx.params.projectId;
		const { detail, viewerIsClient } = resolveProjectShowcase(
			slug,
			asAuthenticatedContext(ctx.state.userContext),
		);
		if (!detail || !viewerIsClient) {
			return new Response(null, { status: 303, headers: { location: `/projects/${slug}` } });
		}
		ctx.state.title = `Edit ${detail.title} · Projective`;
		return page({
			slug,
			title: detail.title,
			description: detail.description,
			format: detail.format,
			stages: [...detail.channels.stages]
				.sort((a, b) => a.order - b.order)
				.map((s) => ({ id: s.id, name: s.name })),
		});
	},
});

export default define.page<typeof handler>(function ProjectEditPage({ data }) {
	return (
		<ProjectEditor
			slug={data.slug}
			initialTitle={data.title}
			initialDescription={data.description}
			initialFormat={data.format}
			initialStages={data.stages}
		/>
	);
});
