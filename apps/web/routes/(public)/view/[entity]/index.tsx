import { page } from "fresh";
import { define } from "@web/utils/state.ts";
import { EntityViewPage } from "@features/view/components/EntityViewPage.tsx";
import { resolveViewPage } from "@features/view/core/view-ssr.ts";

/**
 * `/view/[item_id]?type=[entity_type]` — the public standalone Entity View page (the Explore click
 * matrix target for non-profile entities, and the Search Results drawer's "Open full page"
 * destination). Thin route: resolve the composed page via the fat {@link ExploreBackendService.viewPage}
 * (no HTTP hop) + set SEO, then hand off to the polymorphic {@link EntityViewPage}. `[entity]` is the
 * item id (the segment name is historical; the value is the id). The sidebar action lane is resolved
 * separately by `viewLaneFor` in the `(public)` layout.
 */
export const handler = define.handlers({
	GET(ctx) {
		const { view } = resolveViewPage(ctx.params.entity);
		ctx.state.title = view ? `${view.item.title} · Projective` : "Not found · Projective";
		if (view) ctx.state.description = view.item.summary;
		return page({
			view,
			authed: !!ctx.state.isAuthenticated,
			// The chrome context and the URL travel to the page so the booking offer resolves SERVER-side:
			// the CTA is the reason this route exists, and it must be correct in the first byte rather than
			// after a round trip that changes it under the reader's cursor.
			context: ctx.state.userContext,
			href: ctx.url.href,
		});
	},
});

export default define.page<typeof handler>(function PublicEntityViewRoute({ data }) {
	return (
		<EntityViewPage
			view={data.view}
			ctx={{ scope: "explore" }}
			authed={data.authed}
			context={data.context}
			// Re-hydrated from the serialised href: a `URL` does not survive the route's own data
			// serialisation, and the page needs the search params for the developer overlay.
			url={new URL(data.href)}
		/>
	);
});
