import { getCatalogue, postCatalogue } from "./api.ts";
import type {
	CatalogueListParams,
	CataloguePage,
	CreateListingInput,
	ListingDetail,
	ListingStatus,
	UpdateListingInput,
} from "../types/catalogue-types.ts";
import type { CatalogueResult } from "../types/results.ts";

/**
 * CatalogueService — the THIN client controller for the seller Catalogue (`/catalogue`).
 *
 * A dumb object of named methods; each builds a query string / JSON payload and forwards to
 * `/api/catalogue/*`, returning a soft {@link CatalogueResult}. No fixtures, no query logic — the fat
 * {@link CatalogueBackendService} owns the reads AND the writes; the console / lane / create-modal /
 * editor islands call these for their refines and mutations (mirrors `MessagingService`). Being the
 * first write surface, it exposes the create / update / setStatus mutations alongside the reads.
 */

/** Serialise the list params into the `/api/catalogue/list` query string. */
export function buildListQuery(params: CatalogueListParams): string {
	const qs = new URLSearchParams();
	if (params.type) qs.set("type", params.type);
	if (params.status) qs.set("status", params.status);
	if (params.model) qs.set("model", params.model);
	if (params.search) qs.set("search", params.search);
	if (params.sort) qs.set("sort", params.sort);
	if (params.dir) qs.set("dir", params.dir);
	if (params.needsAttention) qs.set("attention", "1");
	if (params.promoted) qs.set("promoted", "1");
	if (params.cursor) qs.set("cursor", params.cursor);
	if (params.limit) qs.set("limit", String(params.limit));
	return qs.toString();
}

export const CatalogueService = {
	/** Fetch a filtered, sorted, paged page of the seller's listings. */
	list(params: CatalogueListParams): Promise<CatalogueResult<{ page: CataloguePage }>> {
		const qs = buildListQuery(params);
		return getCatalogue<{ page: CataloguePage }>(`/api/catalogue/list${qs ? `?${qs}` : ""}`);
	},

	/** Fetch one listing's full editable detail. */
	detail(id: string): Promise<CatalogueResult<{ listing: ListingDetail }>> {
		const qs = new URLSearchParams({ id });
		return getCatalogue<{ listing: ListingDetail }>(`/api/catalogue/item?${qs.toString()}`);
	},

	/** Create a Draft listing from the modal's minimal fields (→ route to `/catalogue/[id]`). */
	create(input: CreateListingInput): Promise<CatalogueResult<{ listing: ListingDetail }>> {
		return postCatalogue<{ listing: ListingDetail }>("/api/catalogue/create", input);
	},

	/** Persist an editable patch over a listing (autosave / manual save). */
	update(patch: UpdateListingInput): Promise<CatalogueResult<{ listing: ListingDetail }>> {
		return postCatalogue<{ listing: ListingDetail }>("/api/catalogue/update", patch);
	},

	/** Transition a listing's lifecycle state (publish / pause / archive / restore). */
	setStatus(
		id: string,
		status: ListingStatus,
	): Promise<CatalogueResult<{ listing: ListingDetail }>> {
		return postCatalogue<{ listing: ListingDetail }>("/api/catalogue/status", { id, status });
	},
};
