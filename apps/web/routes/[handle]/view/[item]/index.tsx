import { page } from "fresh";
import { define } from "@web/utils/state.ts";
import { EntityViewPage } from "@features/view/components/EntityViewPage.tsx";
import { resolveViewPage } from "@features/view/core/view-ssr.ts";
import { resolveEntityCommerce } from "@features/view/core/booking-ssr.ts";
import { sessionTokenOf } from "@features/view/core/booking-actor.ts";
import { recordViewInBackground } from "@features/explore/core/record-view.ts";
import { rankingHeaders, semanticRankingFor } from "@features/explore/core/discovery-ranking.ts";
import { isRestrictedRequest } from "@web/utils/age-gate.ts";
import { guestIntentRedirect, readViewIntent } from "@features/view/core/view-intent.ts";
import { viewPageMeta } from "@features/view/core/view-canonical.ts";
import { applyPageMeta } from "@features/marketing/core/seo.ts";
import { siteOrigin } from "@features/marketing/core/site-origin.ts";

/**
 * `/[handle]/view/[item_id]?type=[entity_type]` — the profile-scoped Entity View page. This is the
 * Explore click-matrix target for items opened FROM a profile page (vs the public `/view/[id]`). Same
 * polymorphic {@link EntityViewPage}, rendered inside the `[handle]` profile shell with the sidebar
 * action lane (resolved by `viewLaneFor` in the `[handle]` layout) and back links honouring the handle.
 * Its canonical is the public `/view/:slug` (Decision #452), so the listing is indexed once.
 */
export const handler = define.handlers({
	async GET(ctx) {
		const signIn = guestIntentRedirect(ctx.url, !!ctx.state.isAuthenticated);
		if (signIn) return new Response(null, { status: 303, headers: { location: signIn } });
		const { view, status, ranking } = await resolveViewPage(
			ctx.params.item,
			semanticRankingFor(ctx.req),
		);
		ctx.state.title = "Not found · Projective";
		if (view) {
			applyPageMeta(ctx.state, viewPageMeta(view.item, siteOrigin(ctx.url)));
			ctx.state.title = `${view.item.title} · ${ctx.params.handle}`;
			recordViewInBackground(ctx, view.item.id);
		}
		const restricted = isRestrictedRequest(ctx.req, ctx.state.userContext);
		const commerce = view
			? await resolveEntityCommerce(view, {
				context: ctx.state.userContext,
				handle: ctx.params.handle,
				accessToken: sessionTokenOf(ctx),
			})
			: { offer: null };
		return page({
			view,
			unavailable: status >= 500,
			handle: ctx.params.handle,
			authed: !!ctx.state.isAuthenticated,
			offer: commerce.offer,
			restricted,
			intent: readViewIntent(ctx.url.searchParams),
		}, { status: view ? 200 : status, headers: rankingHeaders(ranking) });
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
			restricted={data.restricted}
			intent={data.intent}
		/>
	);
});
