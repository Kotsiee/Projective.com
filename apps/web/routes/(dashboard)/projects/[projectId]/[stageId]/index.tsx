import { define } from "@web/utils/state.ts";
import { PagePlaceholder } from "@web/components/PagePlaceholder.tsx";

/** Nested dynamic route — /projects/:projectId/:stageId (stage-scoped room). */
export default define.page(function StagePage(ctx) {
	return (
		<PagePlaceholder
			title="Stage"
			path={`/projects/${ctx.params.projectId}/${ctx.params.stageId}`}
			note="Stage-scoped view: Chat · Files · Board · Submissions (stage-scoped RLS access)."
		/>
	);
});
