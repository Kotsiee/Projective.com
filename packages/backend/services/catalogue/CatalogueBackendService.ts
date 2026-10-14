import type {
	ApplyListingMediaInput,
	BatchInput,
	BatchOutcome,
	CatalogueListParams,
	CataloguePage,
	CreateListingInput,
	ListingDetail,
	ListingMediaSlot,
	ReorderListingMediaInput,
	SetListingStatusInput,
	UpdateListingInput,
} from "@projective/types/catalogue";
import type { EntityView } from "@projective/types/explore";
import { fail, ok, type ServiceResult } from "../ServiceResult.ts";
import { canReadLive, type ReadActor } from "../read-actor.ts";
import { invalidateCatalog } from "../explore/live-catalog.ts";
import { resolveListing } from "../explore/listing-source.ts";
import { buildLiveViewPage } from "../explore/live-view.ts";
import { reembedInBackground } from "../search/embedding-sync.ts";
import { listingDetail, listListings } from "./live-catalogue.ts";
import {
	applyListingMedia,
	batchListings,
	createListing,
	duplicateListing,
	reorderListingMedia,
	setListingStatus,
	updateListing,
} from "./live-catalogue-writes.ts";

/**
 * CatalogueBackendService — the FAT half of the seller-side Catalogue surface (`/catalogue` +
 * `/catalogue/[id]`). It owns the listing LIST read, a single listing's editable detail, the owner's
 * buyer simulation, and every listing write — create, update, showcase media, lifecycle, batch and
 * duplicate — each returning a transport-agnostic {@link ServiceResult}. The thin `/api/catalogue/*`
 * routes parse + Zod-validate + delegate here; islands never reach it.
 *
 * Everything runs LIVE as the signed-in seller: reads under the catalogue policies (`live-catalogue`),
 * writes through the `catalogue.*` doors (`live-catalogue-writes`). A guest gets a 401 and an
 * unexpected failure a 503 — never a sample catalogue.
 */

type Result<T> = ServiceResult<T>;

const SIGNED_OUT = "Sign in to manage your catalogue.";
const UNREACHABLE = "We couldn't reach your catalogue just now. Try again in a moment.";

/**
 * After a successful write: drop the public catalogue's process-wide cache (a publish, a pause or a
 * save to a live listing changes what discovery shows, and a seller who publishes and opens their
 * listing must not be told it does not exist for a TTL), and re-embed what changed in the background.
 */
function afterWrite<T>(
	result: Result<T>,
	itemIds: (data: T) => string[],
	reason: string,
): Result<T> {
	if (!result.ok || result.data === undefined) return result;
	invalidateCatalog();
	reembedInBackground(itemIds(result.data), reason);
	return result;
}

async function guarded<T>(
	label: string,
	actor: ReadActor,
	run: (actor: ReadActor & { accessToken: string }) => Promise<Result<T>>,
): Promise<Result<T>> {
	if (!canReadLive(actor)) return fail(401, { message: SIGNED_OUT });
	try {
		return await run(actor);
	} catch (error) {
		console.error(`[catalogue:${label}]`, error instanceof Error ? error.message : error);
		return fail(503, { message: UNREACHABLE });
	}
}

const listingId = (data: { listing: ListingDetail }) => [data.listing.id];

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
		return guarded(
			"list",
			actor,
			async (a) => ok({ page: await listListings(params, a, display) }),
		);
	}

	/** A single listing's full editable detail (the manage page), addressed by its `svc-`/`prd-` slug. */
	static detail(id: string, actor: ReadActor): Promise<Result<{ listing: ListingDetail }>> {
		return guarded("detail", actor, async (a) => {
			const listing = await listingDetail(id, a);
			return listing ? ok({ listing }) : fail(404, { message: "No such listing." });
		});
	}

	/** Create a Draft listing from the modal's fields; the client routes to `/catalogue/[id]`. */
	static create(
		input: CreateListingInput,
		actor: ReadActor,
	): Promise<Result<{ listing: ListingDetail }>> {
		return guarded("create", actor, (a) => createListing(input, a));
	}

	/**
	 * Persist an editable patch over a listing (autosave / manual save). A patch made against a stale
	 * `expectedUpdatedAt` is a 409 whose `details.current` is the listing's current `updatedAt`.
	 */
	static update(
		patch: UpdateListingInput,
		actor: ReadActor,
	): Promise<Result<{ listing: ListingDetail }>> {
		return guarded(
			"update",
			actor,
			async (a) => afterWrite(await updateListing(patch, a), listingId, "a listing save"),
		);
	}

	/**
	 * Place library assets into a listing's six-slot showcase: each is cut into its 16:10 rendition,
	 * then the showcase is written (and slot 1 mirrored to the cover) in one door call.
	 */
	static applyMedia(
		input: ApplyListingMediaInput,
		actor: ReadActor,
	): Promise<Result<ListingMediaSlot[]>> {
		return guarded(
			"media",
			actor,
			async (a) =>
				afterWrite(await applyListingMedia(input, a), () => [input.listingId], "a showcase change"),
		);
	}

	/** Reorder a listing's showcase between its filled slots; a video never becomes the cover. */
	static reorderMedia(
		input: ReorderListingMediaInput,
		actor: ReadActor,
	): Promise<Result<ListingMediaSlot[]>> {
		return guarded(
			"media-reorder",
			actor,
			async (a) =>
				afterWrite(
					await reorderListingMedia(input, a),
					() => [input.listingId],
					"a showcase reorder",
				),
		);
	}

	/**
	 * Transition a listing's lifecycle state (publish / pause / archive / restore). Publishing enforces
	 * the gate in the database and answers 422 with what is missing.
	 */
	static setStatus(
		input: SetListingStatusInput,
		actor: ReadActor,
	): Promise<Result<{ listing: ListingDetail }>> {
		return guarded(
			"status",
			actor,
			async (a) =>
				afterWrite(await setListingStatus(input, a), listingId, "a listing status change"),
		);
	}

	/**
	 * Apply one action to up to 100 listings. Always `ok` once the request is accepted: the answer is
	 * one {@link BatchOutcome} per listing, because each passes or fails on its own.
	 */
	static batch(input: BatchInput, actor: ReadActor): Promise<Result<BatchOutcome[]>> {
		return guarded(
			"batch",
			actor,
			async (a) =>
				afterWrite(
					await batchListings(input, a),
					(outcomes) => outcomes.filter((o) => o.ok).map((o) => o.id),
					"a batch change",
				),
		);
	}

	/** Copy a listing as a new draft — every term, and its showcase by file id. */
	static duplicate(id: string, actor: ReadActor): Promise<Result<{ listing: ListingDetail }>> {
		return guarded(
			"duplicate",
			actor,
			async (a) => afterWrite(await duplicateListing(id, a), listingId, "a duplicate"),
		);
	}

	/**
	 * The owner's buyer simulation: the SAME composed {@link EntityView} `/view/[id]` renders, built by
	 * the same assembler from the listing as its seller sees it now — draft and paused included. A
	 * listing that is not the caller's is a 404, worded exactly as a missing one, so the answer never
	 * reveals that it exists.
	 */
	static previewView(id: string, actor: ReadActor): Promise<Result<EntityView>> {
		return guarded("preview", actor, async (a) => {
			const resolved = await resolveListing(id, { as: "owner", actor: a });
			if (resolved === undefined) throw new Error(`the listing source could not read ${id}`);
			if (resolved === null) return fail(404, { message: "No such listing." });
			return ok(await buildLiveViewPage(resolved.catalog, resolved.item));
		});
	}
}
