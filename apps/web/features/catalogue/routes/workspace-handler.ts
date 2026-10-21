import { page } from "fresh";
import { define } from "@web/utils/state.ts";
import { readActor } from "@web/utils/api-session.ts";
import { isRestrictedRequest } from "@web/utils/age-gate.ts";
import { consoleHref, isListingSlug, parseWorkspaceUrl } from "@projective/types/catalogue";
import { resolveListing } from "../core/catalogue-ssr.ts";
import { routeSellerScope } from "../core/seller-scope.ts";

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
 * - `/teams/[teamHandle]/catalogue/[id]` re-exports this page (Decision #312): the team console
 *   decides the address first, the listing is read as the team, and both 303s stay in the team's
 *   catalogue.
 */
export const handler = define.handlers({
	async GET(ctx) {
		const scope = await routeSellerScope(ctx.params.teamHandle, ctx.url, readActor(ctx));
		if (scope instanceof Response) return scope;
		const team = scope.team?.handle;

		if (!isListingSlug(ctx.params.id)) {
			const location = consoleHref({ team, createOpen: true });
			return new Response(null, { status: 303, headers: { location } });
		}
		const { listing, error } = await resolveListing(ctx.params.id, ctx.url, scope.actor);
		if (error) {
			ctx.state.title = "Catalogue · Projective";
			return page({ listing: null, url: null, restricted: false, error }, { status: 503 });
		}
		if (!listing) {
			return new Response(null, { status: 303, headers: { location: consoleHref({ team }) } });
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
