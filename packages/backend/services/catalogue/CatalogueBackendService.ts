import type {
	CatalogueListParams,
	CataloguePage,
	CreateListingInput,
	ListingDetail,
	SetListingStatusInput,
	UpdateListingInput,
} from "@projective/types/catalogue";
import { fail, ok, type ServiceResult } from "../ServiceResult.ts";
import { canReadLive, type ReadActor } from "../read-actor.ts";
import { invalidateCatalog } from "../explore/live-catalog.ts";
import {
	createListing,
	listingDetail,
	listListings,
	setListingStatus,
	updateListing,
} from "./live-catalogue.ts";

/**
 * CatalogueBackendService — the FAT half of the seller-side Catalogue surface (`/catalogue` +
 * `/catalogue/[id]`), and the platform's first write-oriented fat service. It owns the listing LIST
 * read, a single listing's editable detail, and the create / update / publish mutations — each
 * returning a transport-agnostic {@link ServiceResult}. The thin `/api/catalogue/*` routes parse +
 * Zod-validate + delegate here; islands never reach it.
 *
 * Everything runs LIVE as the signed-in seller (`live-catalogue`): reads under the catalogue policies,
 * writes through the `catalogue.*` doors that keep a listing and its product or service blueprint in
 * step. A guest gets a 401 and an unexpected failure a 503 — never a sample catalogue.
 */

type Result<T> = ServiceResult<T>;

const SIGNED_OUT = fail(401, { message: "Sign in to manage your catalogue." });
const UNREACHABLE = fail(503, { message: "We couldn't reach your catalogue just now. Try again in a moment." });

/**
 * A successful write can change what discovery shows — a publish, a pause, or a save to a listing that
 * is already live — so the public catalogue's process-wide cache is dropped rather than left to expire.
 * Without it a seller who publishes and opens their listing is told it does not exist for up to the
 * cache's TTL.
 */
function published<T>(result: Result<T>): Result<T> {
	if (result.ok) invalidateCatalog();
	return result;
}

async function guarded<T>(
	label: string,
	actor: ReadActor,
	run: (actor: ReadActor & { accessToken: string }) => Promise<Result<T>>,
): Promise<Result<T>> {
	if (!canReadLive(actor)) return SIGNED_OUT as Result<T>;
	try {
		return await run(actor);
	} catch (error) {
		console.error(`[catalogue:${label}]`, error instanceof Error ? error.message : error);
		return UNREACHABLE as Result<T>;
	}
}

export class CatalogueBackendService {
	/**
	 * A filtered, sorted, paged page of the acting seller's listings + the KPI roll-up for the chosen
	 * window. `display` is the viewer's display currency — used only when their sales span currencies.
	 */
	static list(
		params: CatalogueListParams,
		actor: ReadActor,
		display: string,
	): Promise<Result<{ page: CataloguePage }>> {
		return guarded("list", actor, async (a) => ok({ page: await listListings(params, a, display) }));
	}

	/** A single listing's full editable detail (the manage page), addressed by its `svc-`/`prd-` slug. */
	static detail(id: string, actor: ReadActor): Promise<Result<{ listing: ListingDetail }>> {
		return guarded("detail", actor, async (a) => {
			const listing = await listingDetail(id, a);
			return listing ? ok({ listing }) : fail(404, { message: "No such listing." }) as Result<{ listing: ListingDetail }>;
		});
	}

	/** Create a Draft listing from the modal's minimal fields; the client routes to `/catalogue/[id]`. */
	static create(input: CreateListingInput, actor: ReadActor): Promise<Result<{ listing: ListingDetail }>> {
		return guarded("create", actor, (a) => createListing(input, a));
	}

	/** Persist an editable patch over a listing (autosave / manual save). */
	static update(patch: UpdateListingInput, actor: ReadActor): Promise<Result<{ listing: ListingDetail }>> {
		return guarded("update", actor, async (a) => published(await updateListing(patch, a)));
	}

	/**
	 * Transition a listing's lifecycle state (publish / pause / archive / restore). Publishing enforces
	 * the gate (title + a price + ≥1 image) in the database and answers 422 with what is missing.
	 */
	static setStatus(input: SetListingStatusInput, actor: ReadActor): Promise<Result<{ listing: ListingDetail }>> {
		return guarded("status", actor, async (a) => published(await setListingStatus(input, a)));
	}
}
