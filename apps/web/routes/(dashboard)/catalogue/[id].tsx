import { page } from "fresh";
import { define } from "@web/utils/state.ts";
import ListingEditor from "@features/catalogue/islands/ListingEditor.island.tsx";
import { resolveListing } from "@features/catalogue/core/catalogue-ssr.ts";

/**
 * `/catalogue/[id]` — the deep per-listing manage page (a full page, not a modal — the service editor is
 * model-heavy and needs room). Thin controller: authed via the `(dashboard)` middleware, seller-ness is
 * chrome + deferred RLS (NOT a hard server capability redirect — see the console route on why the
 * Dev Context Switcher requires this). An unknown id bounces back to `/catalogue`. The SSR listing seeds
 * the two-panel {@link ListingEditor} (form + live public-card preview); every edit/publish goes through
 * the thin `CatalogueService`.
 */
export const handler = define.handlers({
	GET(ctx) {
		const listing = resolveListing(ctx.params.id);
		if (!listing) {
			return new Response(null, { status: 303, headers: { location: "/catalogue" } });
		}
		ctx.state.title = `${listing.title} · Catalogue`;
		return page({ listing });
	},
});

export default define.page<typeof handler>(function ListingManagePage({ data }) {
	return <ListingEditor initial={data.listing} />;
});
