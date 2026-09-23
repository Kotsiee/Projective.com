import { page } from "fresh";
import { define } from "@web/utils/state.ts";
import { readActor } from "@web/utils/api-session.ts";
import ListingEditor from "@features/catalogue/islands/ListingEditor.island.tsx";
import CatalogueUnavailable from "@features/catalogue/islands/CatalogueUnavailable.island.tsx";
import { resolveListing } from "@features/catalogue/core/catalogue-ssr.ts";

/**
 * `/catalogue/[id]` — the deep per-listing manage page, addressed by the listing's `svc-`/`prd-` slug
 * (the same address its public `/view/[id]` page uses). Thin controller: authed via the `(dashboard)`
 * middleware; the listing is read as the signed-in seller, so the catalogue policies decide what they
 * may manage. A listing that is not theirs redirects to `/catalogue`; one that could not be READ says
 * so rather than redirecting, because a bounce would read as though the listing had gone.
 */
export const handler = define.handlers({
	async GET(ctx) {
		const { listing, error } = await resolveListing(ctx.params.id, ctx.url, readActor(ctx));
		if (error) {
			ctx.state.title = "Catalogue · Projective";
			return page({ listing: null, error }, { status: 503 });
		}
		if (!listing) {
			return new Response(null, { status: 303, headers: { location: "/catalogue" } });
		}
		ctx.state.title = `${listing.title} · Catalogue`;
		return page({ listing, error: null });
	},
});

export default define.page<typeof handler>(function ListingManagePage({ data }) {
	if (!data.listing) return <CatalogueUnavailable message={data.error ?? "We couldn't reach this listing."} />;
	return <ListingEditor initial={data.listing} />;
});
