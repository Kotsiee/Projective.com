import { page } from "fresh";
import { define } from "@web/utils/state.ts";
import { EntityView } from "@features/explore/components/EntityView.tsx";
import { ExploreBackendService } from "@server/services/explore/ExploreBackendService.ts";

/**
 * `/[handle]/view/[item_id]?type=[entity_type]` — the profile-scoped item viewer. This is the Explore
 * click-matrix target for items opened FROM a profile page (vs the public `/view/[id]`). Same
 * {@link EntityView}, rendered inside the `[handle]` profile shell, with a back link to the handle.
 */
export const handler = define.handlers({
	GET(ctx) {
		const result = ExploreBackendService.item(ctx.params.item);
		const item = result.ok ? result.data?.item : undefined;
		ctx.state.title = item ? `${item.title} · ${ctx.params.handle}` : "Not found · Projective";
		if (item) ctx.state.description = item.summary;
		return page({ item, handle: ctx.params.handle });
	},
});

export default define.page<typeof handler>(function ProfileEntityViewPage({ data }) {
	return (
		<EntityView
			item={data.item}
			ctx={{ scope: "profile", handle: data.handle }}
			backHref={`/${data.handle}`}
		/>
	);
});
