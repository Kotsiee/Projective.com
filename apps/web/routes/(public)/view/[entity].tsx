import { page } from "fresh";
import { define } from "@web/utils/state.ts";
import { EntityView } from "@features/explore/components/EntityView.tsx";
import { ExploreBackendService } from "@server/services/explore/ExploreBackendService.ts";

/**
 * `/view/[item_id]?type=[entity_type]` — the public standalone item viewer (the Explore click matrix
 * target for non-profile entities, and the Search Results drawer's "Open full page" destination).
 * Thin route: resolve the item via the fat {@link ExploreBackendService} + set SEO, then hand off to
 * {@link EntityView}. `[entity]` is the item id (the segment name is historical; the value is the id).
 */
export const handler = define.handlers({
	GET(ctx) {
		const result = ExploreBackendService.item(ctx.params.entity);
		const item = result.ok ? result.data?.item : undefined;
		ctx.state.title = item ? `${item.title} · Projective` : "Not found · Projective";
		if (item) ctx.state.description = item.summary;
		return page({ item });
	},
});

export default define.page<typeof handler>(function EntityViewPage({ data }) {
	return <EntityView item={data.item} ctx={{ scope: "explore" }} />;
});
