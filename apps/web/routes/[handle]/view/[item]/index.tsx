import { page } from "fresh";
import { define } from "@web/utils/state.ts";
import { EntityViewPage } from "@features/view/components/EntityViewPage.tsx";
import { resolveViewPage } from "@features/view/core/view-ssr.ts";
import { resolveEntityCommerce } from "@features/view/core/booking-ssr.ts";
import { viewerFromState } from "@features/calendar/core/viewer.ts";

/**
 * `/[handle]/view/[item_id]?type=[entity_type]` — the profile-scoped Entity View page. This is the
 * Explore click-matrix target for items opened FROM a profile page (vs the public `/view/[id]`). Same
 * polymorphic {@link EntityViewPage}, rendered inside the `[handle]` profile shell with the sidebar
 * action lane (resolved by `viewLaneFor` in the `[handle]` layout) and back links honouring the handle.
 * Its session-schedule leaf lives alongside as `[item]/schedule.tsx`.
 */
export const handler = define.handlers({
	async GET(ctx) {
		const { view, status } = await resolveViewPage(ctx.params.item);
		ctx.state.title = view ? `${view.item.title} · ${ctx.params.handle}` : "Not found · Projective";
		if (view) ctx.state.description = view.item.summary;
		const commerce = view
			? await resolveEntityCommerce(view, {
				context: ctx.state.userContext,
				handle: ctx.params.handle,
				viewer: viewerFromState(ctx.state),
			})
			: { offer: null, schedule: null };
		return page({
			view,
			unavailable: status >= 500,
			handle: ctx.params.handle,
			authed: !!ctx.state.isAuthenticated,
			offer: commerce.offer,
			schedule: commerce.schedule,
		}, { status: view ? 200 : status });
	},
});

export default define.page<typeof handler>(function ProfileEntityViewPage({ data }) {
	return (
		<EntityViewPage
			view={data.view}
			unavailable={data.unavailable}
			ctx={{ scope: "profile", handle: data.handle }}
			authed={data.authed}
			offer={data.offer}
			schedule={data.schedule}
		/>
	);
});
