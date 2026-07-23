import { page } from "fresh";
import { define } from "@web/utils/state.ts";
import { EntityViewScreen } from "@features/view/components/EntityViewScreen.tsx";
import { resolveViewPage } from "@features/view/core/view-ssr.ts";

/**
 * `/[handle]/view/[item_id]?type=[entity_type]` — the profile-scoped Entity View page. This is the
 * Explore click-matrix target for items opened FROM a profile page (vs the public `/view/[id]`). Same
 * Amazon-style {@link EntityViewScreen}, rendered inside the `[handle]` profile shell with the sidebar
 * action lane (resolved by `viewLaneFor` in the `[handle]` layout) and back links honouring the handle.
 * Its session-schedule leaf lives alongside as `[item]/schedule.tsx`.
 */
export const handler = define.handlers({
	GET(ctx) {
		const { view } = resolveViewPage(ctx.params.item);
		ctx.state.title = view ? `${view.item.title} · ${ctx.params.handle}` : "Not found · Projective";
		if (view) ctx.state.description = view.item.summary;
		return page({ view, handle: ctx.params.handle, authed: !!ctx.state.isAuthenticated });
	},
});

export default define.page<typeof handler>(function ProfileEntityViewPage({ data }) {
	return (
		<EntityViewScreen
			view={data.view}
			ctx={{ scope: "profile", handle: data.handle }}
			authed={data.authed}
		/>
	);
});
