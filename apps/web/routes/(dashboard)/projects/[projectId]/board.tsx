import { define } from "@web/utils/state.ts";
import { PagePlaceholder } from "@web/components/PagePlaceholder.tsx";

export default define.page(function ProjectBoardPage(ctx) {
	return (
		<PagePlaceholder
			title="Board"
			path={`/projects/${ctx.params.projectId}/board`}
			note="Kanban / Timeline — tiered D3→Canvas2D→PIXI charts (DESIGN_SYSTEM.md §C.5)."
		/>
	);
});
