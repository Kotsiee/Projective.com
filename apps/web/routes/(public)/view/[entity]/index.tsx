import { page } from "fresh";
import { define } from "@web/utils/state.ts";
import { EntityViewPage } from "@features/view/components/EntityViewPage.tsx";
import { resolveViewPage } from "@features/view/core/view-ssr.ts";
import { resolveEntityCommerce } from "@features/view/core/booking-ssr.ts";
import { viewerFromState } from "@features/calendar/core/viewer.ts";

/**
 * `/view/[item_id]?type=[entity_type]` — the public standalone Entity View page (the Explore click
 * matrix target for non-profile entities, and the Search Results drawer's "Open full page"
 * destination). Thin route: resolve the composed page via the fat {@link ExploreBackendService.viewPage}
 * (no HTTP hop) + set SEO, then hand off to the polymorphic {@link EntityViewPage}. `[entity]` is the
 * item id (the segment name is historical; the value is the id). The sidebar action lane is resolved
 * separately by `viewLaneFor` in the `(public)` layout.
 */
export const handler = define.handlers({
	async GET(ctx) {
		const { view, status } = await resolveViewPage(ctx.params.entity);
		ctx.state.title = view ? `${view.item.title} · Projective` : "Not found · Projective";
		if (view) ctx.state.description = view.item.summary;
		// The booking offer and a session's schedule are resolved HERE, server-side: the CTA is the reason
		// this route exists, and it must be correct in the first byte rather than after a round trip that
		// changes it under the reader's cursor.
		const commerce = view
			? await resolveEntityCommerce(view, {
				context: ctx.state.userContext,
				handle: null,
				viewer: viewerFromState(ctx.state),
			})
			: { offer: null, schedule: null };
		return page({
			view,
			unavailable: status >= 500,
			authed: !!ctx.state.isAuthenticated,
			offer: commerce.offer,
			schedule: commerce.schedule,
			// The page renders its own not-found / unavailable state, and the STATUS says so too — a
			// crawler or a link checker must not record a missing listing as a live 200.
		}, { status: view ? 200 : status });
	},
});

export default define.page<typeof handler>(function PublicEntityViewRoute({ data }) {
	return (
		<EntityViewPage
			view={data.view}
			unavailable={data.unavailable}
			ctx={{ scope: "explore" }}
			authed={data.authed}
			offer={data.offer}
			schedule={data.schedule}
		/>
	);
});
