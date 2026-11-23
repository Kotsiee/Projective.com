import { page } from "fresh";
import { define } from "@web/utils/state.ts";
import { readActor } from "@web/utils/api-session.ts";
import {
	consoleHref,
	isListingSlug,
	type ListingDetail,
	type ListingSubPage,
	parseWorkspaceUrl,
	type WorkspaceUrlState,
} from "@projective/types/catalogue";
import { resolveListing } from "../core/catalogue-ssr.ts";
import { routeSellerScope } from "../core/seller-scope.ts";
import { subPageRedirect } from "../core/sub-page-route.ts";

/** What a sub-page renders from. */
export interface SubPageData {
	listing: ListingDetail | null;
	url: WorkspaceUrlState | null;
	error: string | null;
}

const TITLES: Readonly<Record<ListingSubPage, string>> = {
	plan: "Session plan",
	questions: "Buyer questions",
};

/**
 * The handler for one of a listing's Edit sub-pages (`/catalogue/[id]/plan`, `/questions`, Decision
 * #525; and their `/teams/[teamHandle]/catalogue` twins, Decision #312), kept apart from the pages so
 * it loads without an island or a stylesheet. The workspace's own guards, in its order: a non-slug
 * is a 303 to the console's quick-create, a listing that is not the caller's a 303 to the console,
 * a failed read a 503 that says so. Then the page's own: a listing the page does not serve
 * ({@link subPageRedirect}) is a 303 back to its workspace.
 */
export function subPageHandler(subPage: ListingSubPage) {
	return define.handlers({
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
				const data: SubPageData = { listing: null, url: null, error };
				return page(data, { status: 503 });
			}
			if (!listing) {
				return new Response(null, { status: 303, headers: { location: consoleHref({ team }) } });
			}
			const elsewhere = subPageRedirect(listing, subPage, team);
			if (elsewhere) {
				return new Response(null, { status: 303, headers: { location: elsewhere } });
			}
			ctx.state.title = `${TITLES[subPage]} · ${listing.title}`;
			const data: SubPageData = {
				listing,
				url: { ...parseWorkspaceUrl(ctx.url), tab: "edit" },
				error: null,
			};
			return page(data);
		},
	});
}

/** `/catalogue/[id]/plan`'s handler. */
export const planHandler = subPageHandler("plan");

/** `/catalogue/[id]/questions`'s handler. */
export const questionsHandler = subPageHandler("questions");
