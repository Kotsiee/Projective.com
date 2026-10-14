import { page } from "fresh";
import { define } from "@web/utils/state.ts";
import { readActor } from "@web/utils/api-session.ts";
import { isRestrictedRequest } from "@web/utils/age-gate.ts";
import { isListingSlug, parseWorkspaceUrl } from "@projective/types/catalogue";
import { resolveListing } from "../core/catalogue-ssr.ts";

/**
 * `/catalogue/[id]`'s handler — kept apart from the page so it loads without an island or a
 * stylesheet (a contract test imports it under `deno test`).
 *
 * - Anything that is not a listing slug (`/catalogue/new`, a uuid) is never read: it is a 303 to
 *   the console's quick-create, because creation is a modal there and never a page of its own.
 * - The listing is read as the signed-in seller through the request memo the bands share. One that
 *   is not theirs is a 303 to `/catalogue`; one that could not be READ is a 503 that says so,
 *   because a bounce would read as though the listing had gone.
 * - The URL contract (`?tab=&section=&device=&period=&client=`) is resolved here, so the first byte
 *   paints the right tab.
 * - Whether the seller is a restricted (13–17) account is resolved here too (Decision #208): the
 *   islands cannot read it, and the Availability section hides behind a notice for one.
 */
export const handler = define.handlers({
	async GET(ctx) {
		if (!isListingSlug(ctx.params.id)) {
			return new Response(null, { status: 303, headers: { location: "/catalogue?create=1" } });
		}
		const { listing, error } = await resolveListing(ctx.params.id, ctx.url, readActor(ctx));
		if (error) {
			ctx.state.title = "Catalogue · Projective";
			return page({ listing: null, url: null, restricted: false, error }, { status: 503 });
		}
		if (!listing) {
			return new Response(null, { status: 303, headers: { location: "/catalogue" } });
		}
		ctx.state.title = `${listing.title} · Catalogue`;
		return page({
			listing,
			url: parseWorkspaceUrl(ctx.url),
			restricted: isRestrictedRequest(ctx.req, ctx.state.userContext),
			error: null,
		});
	},
});
