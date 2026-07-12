import { page } from "fresh";
import { define } from "@web/utils/state.ts";
import { PagePlaceholder } from "@web/components/PagePlaceholder.tsx";

/**
 * Thin-controller pattern (SYSTEM_ARCHITECTURE §2 / §State Hydration): the handler parses params,
 * guards, and delegates to a Service, then hands resolved data to the page via `page(data)`. The
 * page stays presentational; islands receive `initialData` as props (never fetch directly).
 */
export const handler = define.handlers({
	GET(ctx) {
		// TODO: const project = await ProjectService.getById(ctx.params.projectId, ctx.state);
		return page({ projectId: ctx.params.projectId });
	},
});

export default define.page<typeof handler>(function ProjectDetailPage({ data }) {
	return (
		<PagePlaceholder
			title="Project"
			path={`/projects/${data.projectId}`}
			note="Master-detail overview. Stages, tickets, escrow status (PRODUCT_SPEC §Stage Management)."
		/>
	);
});
