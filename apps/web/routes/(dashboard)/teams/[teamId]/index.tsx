import { define } from "@web/utils/state.ts";
import { PagePlaceholder } from "@web/components/PagePlaceholder.tsx";

export default define.page(function TeamDetailPage(ctx) {
	return (
		<PagePlaceholder
			title="Team"
			path={`/teams/${ctx.params.teamId}`}
			note="Team overview: members, projects, settings, shared vault."
		/>
	);
});
