import type { UserContext } from "@projective/types/auth";
import { CatalogueBackendService } from "@server/services/catalogue/CatalogueBackendService.ts";
import { isSeller } from "./catalogue-model.ts";
import type {
	CatalogueListParams,
	CataloguePage,
	ListingDetail,
} from "../types/catalogue-types.ts";

/**
 * catalogue-ssr — the server-only bootstraps for the Catalogue surface's first paint. They call the fat
 * {@link CatalogueBackendService} directly (no HTTP hop) so the console + lane ship their first page in
 * the initial byte; the islands then refine via the thin {@link CatalogueService}. Mirror
 * `resolveProjectsFeed` / `resolveConversationList`. Never imported by an island.
 *
 * The chrome-only seller predicate ({@link isSeller}, re-derived from the acting context) gates the
 * surface visually; RLS + the route guard remain the real access gates.
 */

/** Everything the console / lane needs to paint the listing list without a client round-trip. */
export interface CatalogueBootstrap {
	page: CataloguePage;
	/** Whether the acting context is a seller (chrome-only). */
	seller: boolean;
}

const EMPTY_PAGE: CataloguePage = {
	items: [],
	hasMore: false,
	nextCursor: null,
	total: 0,
	statusCounts: { draft: 0, published: 0, paused: 0, archived: 0 },
	stats: {
		activeListings: 0,
		totalListings: 0,
		views30d: 0,
		orders: 0,
		revenue: 0,
		revenueLabel: "$0",
		avgRating: 0,
		trend: [],
	},
	viewerId: "",
};

/** Resolve the initial catalogue page for the given list params + acting context. */
export function resolveCataloguePage(
	context: UserContext,
	params: CatalogueListParams = {},
): CatalogueBootstrap {
	const res = CatalogueBackendService.list(params);
	return {
		page: res.ok && res.data ? res.data.page : EMPTY_PAGE,
		seller: isSeller(context),
	};
}

/** Resolve a single listing's editable detail (the manage page), or null. */
export function resolveListing(id: string): ListingDetail | null {
	const res = CatalogueBackendService.detail(id);
	return res.ok && res.data ? res.data.listing : null;
}
