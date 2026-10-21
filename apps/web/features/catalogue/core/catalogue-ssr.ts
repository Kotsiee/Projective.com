import type { UserContext } from "@projective/types/auth";
import type { ReadActor } from "@server/services/read-actor.ts";
import { CatalogueBackendService } from "@server/services/catalogue/CatalogueBackendService.ts";
import { isSeller } from "./catalogue-model.ts";
import { listParamsOf } from "./console-store.ts";
import { EMPTY_FACET_COUNTS, parseConsoleUrl } from "../types/catalogue-types.ts";
import type {
	CatalogueListParams,
	CataloguePage,
	ListingDetail,
} from "../types/catalogue-types.ts";

/**
 * catalogue-ssr — the server-only bootstraps for the Catalogue surface's first paint. They call the fat
 * {@link CatalogueBackendService} directly (no HTTP hop), as the signed-in seller, so the console, the
 * lane and the header and footer bands ship their first page in the initial byte; the islands then
 * refine via the thin `CatalogueService`. On a team catalogue the actor is the team's
 * (`seller-scope.ts`, Decision #312), so the memo keys on the context as well as the user. Never
 * imported by an island.
 *
 * A read that fails is reported as a failure (`error`), never as an empty catalogue: "you have no
 * listings" is a claim about the seller's work, and a false one when the truth is that it could not be
 * read.
 */

/** Everything the console / lane needs to paint the listing list without a client round-trip. */
export interface CatalogueBootstrap {
	page: CataloguePage;
	/** Why the page could not be read, or `null`. */
	error: string | null;
	/** Whether the acting context is a seller (chrome-only). */
	seller: boolean;
}

const EMPTY_PAGE: CataloguePage = {
	items: [],
	hasMore: false,
	nextCursor: null,
	total: 0,
	statusCounts: { draft: 0, published: 0, paused: 0, archived: 0 },
	facetCounts: EMPTY_FACET_COUNTS,
	stats: {
		activeListings: 0,
		totalListings: 0,
		views: 0,
		period: "30d",
		asOf: null,
		orders: 0,
		revenue: 0,
		revenueLabel: "",
		revenueChange: null,
		conversion: null,
		avgRating: 0,
	},
	viewerId: "",
};

// #region Request-scoped memo
/**
 * One read per question per request. The page, the lane and both bands resolve the catalogue; keyed on
 * the request's `URL` object (the `calendar-slots` / `wallet-ssr` precedent) so an entry cannot outlive
 * its request, with the stored PROMISE shared by the bands resolved concurrently.
 */
const READS = new WeakMap<URL, Map<string, Promise<unknown>>>();

function once<T>(url: URL, key: string, run: () => Promise<T>): Promise<T> {
	let reads = READS.get(url);
	if (!reads) {
		reads = new Map();
		READS.set(url, reads);
	}
	const hit = reads.get(key) as Promise<T> | undefined;
	if (hit) return hit;
	const promise = run();
	reads.set(key, promise);
	return promise;
}
// #endregion

// #region Params
/**
 * The console's list params for a URL — the same derivation the console store refetches with
 * ({@link listParamsOf}), so the page, the lane and the header band share one read through the memo,
 * and the first client read after a change asks exactly what the server would have.
 */
export function consoleParamsOf(url: URL): CatalogueListParams {
	return listParamsOf(parseConsoleUrl(url));
}

/**
 * The outline lane's list params: every listing the seller has, newest first, at the largest page the
 * service serves, so the workspace's lane can always show the rest of the catalogue.
 */
export function outlineParamsOf(): CatalogueListParams {
	return { type: "all", sort: "recent", limit: 200 };
}
// #endregion

/** Resolve a catalogue page for the given list params, as the acting seller. */
export function resolveCataloguePage(
	context: UserContext,
	url: URL,
	actor: ReadActor,
	params: CatalogueListParams = {},
): Promise<CatalogueBootstrap> {
	return once(url, `page|${actor.userId}|${actor.contextId}|${JSON.stringify(params)}`, async () => {
		const res = await CatalogueBackendService.list(params, actor, context.displayCurrency);
		return {
			page: res.ok && res.data ? res.data.page : EMPTY_PAGE,
			error: res.ok ? null : res.message ?? "We couldn't reach your catalogue just now.",
			seller: isSeller(context),
		};
	});
}

/** A manage-page read: the listing, `null` when it is not the caller's to manage, or why it failed. */
export interface ListingRead {
	listing: ListingDetail | null;
	/** Set when the read FAILED (not when the listing simply is not theirs) — the page says so. */
	error: string | null;
}

/** Resolve a single listing's editable detail (the manage page), as the acting seller. */
export function resolveListing(id: string, url: URL, actor: ReadActor): Promise<ListingRead> {
	return once(url, `listing|${actor.userId}|${actor.contextId}|${id}`, async () => {
		const res = await CatalogueBackendService.detail(id, actor);
		if (res.ok && res.data) return { listing: res.data.listing, error: null };
		return {
			listing: null,
			error: res.status === 404 ? null : res.message ?? "We couldn't reach this listing just now.",
		};
	});
}
