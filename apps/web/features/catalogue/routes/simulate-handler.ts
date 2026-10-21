import { page } from "fresh";
import { define } from "@web/utils/state.ts";
import { readActor } from "@web/utils/api-session.ts";
import { cspHeaderFor } from "@web/utils/csp.ts";
import { isListingSlug } from "@projective/types/catalogue";
import { CatalogueBackendService } from "@server/services/catalogue/CatalogueBackendService.ts";
import { resolveEntityCommerce } from "@features/view/core/booking-ssr.ts";
import { viewerFromState } from "@features/calendar/core/viewer.ts";
import { routeSellerScope } from "../core/seller-scope.ts";

/**
 * `/catalogue/[id]/simulate`'s handler — the owner's buyer simulation (Decision #217 (j), plan §4.6
 * item 3), kept apart from the page so it loads without an island or a stylesheet (a contract test
 * imports it under `deno test`).
 *
 * - Anything that is not a listing slug is never read: a 404.
 * - The listing is read as its OWNER through `CatalogueBackendService.previewView`, the same
 *   `EntityView` assembler `/view/[id]` uses, so a draft simulates. A listing that is not the
 *   caller's is a 404, exactly as a missing one, so the answer never reveals that it exists.
 * - The offer and a session listing's schedule are resolved in simulation mode: the real offer, for
 *   a signed-in first-time buyer, without the owner's own "already in your projects" or sign-in states.
 * - Every answer carries the `framed` policy (`frame-ancestors 'self'`, paired by the middleware with
 *   `x-frame-options: SAMEORIGIN`): only this origin — the item workspace's Preview tab — may frame
 *   it, and a not-found inside the frame still renders as a page rather than a refused frame.
 * - The view is never recorded as an interest event: the owner looking at their own listing is not
 *   a buyer's view.
 * - `/teams/[teamHandle]/catalogue/[id]/simulate` re-exports this page (Decision #312), read as the
 *   team. A non-canonical handle still 308s; any other refusal of the team console (not a member,
 *   no `publish_listings`) is the same framed 404, so the frame never paints another page.
 */
const FRAMED_HEADERS = (): HeadersInit => ({ "content-security-policy": cspHeaderFor("framed") });

export const handler = define.handlers({
	async GET(ctx) {
		const slug = ctx.params.id;
		const scope = await routeSellerScope(ctx.params.teamHandle, ctx.url, readActor(ctx));
		if (scope instanceof Response && scope.status === 308) return scope;
		if (!isListingSlug(slug) || scope instanceof Response) {
			ctx.state.title = "Preview · Catalogue";
			return page({ view: null, offer: null, schedule: null, unavailable: false }, {
				status: 404,
				headers: FRAMED_HEADERS(),
			});
		}

		const { actor } = scope;
		const read = await CatalogueBackendService.previewView(slug, actor);
		if (!read.ok || !read.data) {
			const unavailable = read.status >= 500;
			ctx.state.title = "Preview · Catalogue";
			return page({ view: null, offer: null, schedule: null, unavailable }, {
				status: unavailable ? 503 : 404,
				headers: FRAMED_HEADERS(),
			});
		}

		const view = read.data;
		const commerce = await resolveEntityCommerce(view, {
			context: ctx.state.userContext,
			handle: null,
			viewer: viewerFromState(ctx.state),
			simulation: { owner: actor },
		});
		ctx.state.title = `Preview ${view.item.title} · Catalogue`;
		return page({
			view,
			offer: commerce.offer,
			schedule: commerce.schedule,
			unavailable: false,
		}, { headers: FRAMED_HEADERS() });
	},
});
