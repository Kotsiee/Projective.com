import { define } from "@web/utils/state.ts";
import { PagePlaceholder } from "@web/components/PagePlaceholder.tsx";

/** Public entity viewer — /view/:entity (dynamic segment). */
export default define.page(function EntityViewPage(ctx) {
	return (
		<PagePlaceholder
			title="Entity Viewer"
			path={`/view/${ctx.params.entity}`}
			note="Public read-only entity viewer (dynamic [entity] segment)."
		/>
	);
});
