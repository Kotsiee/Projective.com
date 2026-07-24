import type {
	CatalogueListParams,
	CataloguePage,
	CreateListingInput,
	ListingDetail,
	SetListingStatusInput,
	UpdateListingInput,
} from "@projective/types/catalogue";
import { fail, ok, type ServiceResult } from "../ServiceResult.ts";
import { isCatalogueBackendLive } from "../../core/supabase.ts";
import {
	createListing,
	findListing,
	listListings,
	setListingStatus,
	updateListing,
} from "./catalogue-fixtures.ts";

/**
 * CatalogueBackendService — the FAT half of the seller-side Catalogue surface (`/catalogue` +
 * `/catalogue/[id]`), and the platform's FIRST write-oriented fat service (thin-routes / fat-services,
 * root CLAUDE.md §10 / SYSTEM_ARCHITECTURE §Backend Services). It owns the listing LIST read, a single
 * listing's editable detail, and the create / update / publish (setStatus) mutations — each returning a
 * transport-agnostic {@link ServiceResult}. The thin `/api/catalogue/*` routes parse + Zod-validate +
 * seller-guard + delegate here; islands never reach it.
 *
 * Gated by {@link isCatalogueBackendLive} (`CATALOGUE_BACKEND_LIVE`, default off): until the RLS-scoped
 * `catalogue.*` tables + mutation policies land, reads answer from the deterministic fixtures and writes
 * mutate an in-module session store (so create→edit→publish is fully exercisable, granting no
 * persistence). The LIVE branch is a documented placeholder that currently falls back to the same store
 * with zero shape churn (the projections are already the Zod SSOT), exactly like the read-only services.
 */
export class CatalogueBackendService {
	/** A filtered, sorted, paged page of the acting seller's listings + the rolled-up KPI stats. */
	static list(params: CatalogueListParams): ServiceResult<{ page: CataloguePage }> {
		if (!isCatalogueBackendLive()) return ok({ page: listListings(params) });
		// LIVE: read RLS-scoped `catalogue.listings` — not yet implemented; fall back to fixtures.
		return ok({ page: listListings(params) });
	}

	/** A single listing's full editable detail (the manage page). */
	static detail(id: string): ServiceResult<{ listing: ListingDetail }> {
		const listing = findListing(id);
		if (!listing) return fail(404, { message: "No such listing." });
		return ok({ listing });
	}

	/**
	 * Create a Draft listing from the modal's minimal fields (title + kind + delivery model). Returns the
	 * optimistic draft so the client can route straight to `/catalogue/[id]` for the deep edit.
	 */
	static create(input: CreateListingInput): ServiceResult<{ listing: ListingDetail }> {
		const listing = createListing(input);
		return ok({ listing }, { status: 201, message: "Draft created." });
	}

	/** Persist an editable patch over a listing (autosave / manual save). */
	static update(patch: UpdateListingInput): ServiceResult<{ listing: ListingDetail }> {
		const listing = updateListing(patch);
		if (!listing) return fail(404, { message: "No such listing." });
		return ok({ listing }, { message: "Saved." });
	}

	/**
	 * Transition a listing's lifecycle state (publish / pause / archive / restore). A publish enforces
	 * the publish gate (title + a price + ≥1 media) and returns a 422 with the missing pieces when unmet.
	 */
	static setStatus(input: SetListingStatusInput): ServiceResult<{ listing: ListingDetail }> {
		const { detail, blocked } = setListingStatus(input);
		if (blocked) {
			return fail(422, {
				message: `Add ${blocked.join(", ")} before publishing.`,
				errors: { publish: blocked.join(", ") },
			});
		}
		if (!detail) return fail(404, { message: "No such listing." });
		return ok({ listing: detail }, { message: statusMessage(input.status) });
	}
}

/** A friendly confirmation for a completed status transition. */
function statusMessage(status: SetListingStatusInput["status"]): string {
	switch (status) {
		case "published":
			return "Listing published.";
		case "paused":
			return "Listing paused.";
		case "archived":
			return "Listing archived.";
		case "draft":
			return "Listing moved to drafts.";
	}
}
