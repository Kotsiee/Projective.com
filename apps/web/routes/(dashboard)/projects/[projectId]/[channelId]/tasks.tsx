import { define } from "@web/utils/state.ts";
import { ChannelTabBody } from "@web/features/projects/components/ChannelTabBody.tsx";

/**
 * Tasks tab — the Kanban board scoped to this stage. Present on pipeline engagements only (the header
 * omits the tab otherwise). Renders with the tiered chart engine (D3 → Canvas2D → PIXI) when built.
 */
export default define.page(function ChannelTasksPage() {
	return (
		<ChannelTabBody
			title="Tasks"
			note="The Kanban board for this stage's tickets — drag cards across columns as work moves through the pipeline."
			filler={6}
		/>
	);
});
