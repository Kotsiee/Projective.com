import { page } from "fresh";
import { define } from "@web/utils/state.ts";
import { EntityViewScreen } from "@features/view/components/EntityViewScreen.tsx";
import { resolveViewPage } from "@features/view/core/view-ssr.ts";

/**
 * `/view/[item_id]?type=[entity_type]` — the public standalone Entity View page (the Explore click
 * matrix target for non-profile entities, and the Search Results drawer's "Open full page"
 * destination). Thin route: resolve the composed page via the fat {@link ExploreBackendService.viewPage}
 * (no HTTP hop) + set SEO, then hand off to the Amazon-style {@link EntityViewScreen}. `[entity]` is the
 * item id (the segment name is historical; the value is the id). The sidebar action lane is resolved
 * separately by `viewLaneFor` in the `(public)` layout.
 */
export const handler = define.handlers({
	GET(ctx) {
		const { view } = resolveViewPage(ctx.params.entity);
		ctx.state.title = view ? `${view.item.title} · Projective` : "Not found · Projective";
		if (view) ctx.state.description = view.item.summary;
		return page({ view, authed: !!ctx.state.isAuthenticated });
	},
});

export default define.page<typeof handler>(function EntityViewPage({ data }) {
	return <EntityViewScreen view={data.view} ctx={{ scope: "explore" }} authed={data.authed} />;
});
