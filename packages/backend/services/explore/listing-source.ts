import type { EntityView, ExploreItem } from "@projective/types/explore";
import type { SupabaseClient } from "supabaseClient";
import { isExploreBackendLive } from "../../core/supabase.ts";
import { canReadLive, type ReadActor } from "../read-actor.ts";
import { ownsListing } from "../catalogue/ownership.ts";
import {
	type Catalog,
	loadCatalog,
	type OwnerRead,
	peekCatalog,
	readListing,
	warmCatalog,
} from "./live-catalog.ts";
import { composeViewPage } from "./live-view.ts";

/**
 * listing-source — the ONE place a write path resolves the listing it is acting on.
 *
 * Booking a session, scoping a one-off, asking a question, requesting a quote and instantiating a
 * pipeline all validate the buyer's choices against a listing: its format, its intake questions, its
 * stage template, its owner. Each used to resolve that listing from the process-wide catalogue
 * snapshot (`findItem` → `peekCatalog`), which is shared, up to one TTL behind the seller, and served
 * indefinitely when reloads fail — the right source for rendering a grid of cards, the wrong one for
 * committing against a single listing.
 *
 * ## The seam
 *
 * - **`EXPLORE_BACKEND_LIVE` on:** the listing is read FRESH ({@link readListing}) — its listing row,
 *   blueprint or product, gallery and skills, as published right now — and composed through the same
 *   {@link composeViewPage} the page used, so the intake and stages a buyer is validated against are
 *   the seller's current ones. The loaded catalogue supplies only the profile directory (owner names).
 * - **Off:** the snapshot, exactly as before — the existing `*_BACKEND_LIVE=false` seam, which is where
 *   service-level tests prime a catalogue with `primeCatalogForTesting`.
 *
 * `undefined` means the database could not answer (callers answer `503`); `null` means there is no
 * such published listing (`404`).
 *
 * ## The owner's read
 *
 * `{ as: "owner", actor }` resolves the listing the way its SELLER sees it — always live, with their
 * token, draft and paused included — for the workspace's buyer simulation. A listing that is not the
 * actor's resolves to `null` exactly as a missing one does, so the answer never confirms it exists.
 */

/** A listing resolved for a write: the item, its composed page, and the catalogue it was read into. */
export interface ResolvedListing {
	item: ExploreItem;
	view: EntityView;
	/** The catalogue the item resolves in — for the subject rows (`blueprintBySlug`, …) behind it. */
	catalog: Catalog;
}

/** Resolve a listing as its seller sees it (see "The owner's read" above). */
export interface OwnerListingRead {
	as: "owner";
	actor: ReadActor;
	/** The session client to read with; defaults to the actor's (a test passes a stub). */
	client?: SupabaseClient;
}

/**
 * Resolve one listing by its item id (`svc-…` / `prd-…`). See the module header for the seam.
 *
 * A boolean overrides which flag decides the seam. A write that commits under another domain's flag
 * passes that flag, so the listing it validates against and the write it makes are both live or both
 * stubbed — never a live listing driving a stub write, or a snapshot driving a live one.
 */
export async function resolveListing(
	itemId: string,
	mode: boolean | OwnerListingRead = isExploreBackendLive(),
): Promise<ResolvedListing | null | undefined> {
	const asOwner = typeof mode === "object" ? ownerRead(mode.actor, mode.client) : undefined;
	if (typeof mode === "object" && !asOwner) return null;
	if (asOwner || mode === true) {
		let base: Catalog | null;
		try {
			base = await loadCatalog();
		} catch {
			// The profile directory is all this read borrows; the last good load serves for that.
			base = peekCatalog();
		}
		if (!base) return undefined;
		try {
			const fresh = await readListing(itemId, base, asOwner);
			const item = fresh?.byId.get(itemId);
			if (!fresh || !item) return null;
			return { item, view: composeViewPage(fresh, item), catalog: fresh };
		} catch (error) {
			const reason = error instanceof Error ? error.message : String(error);
			console.warn(`[listing-source] live listing read failed for ${itemId}: ${reason}`);
			return undefined;
		}
	}

	// Warm only when nothing has loaded: the routes on this seam already warm per request, and a test
	// that primed a snapshot must not reach for a database it does not have.
	if (!peekCatalog()) await warmCatalog();
	const catalog = peekCatalog();
	const item = catalog?.byId.get(itemId);
	if (!catalog || !item) return null;
	return { item, view: composeViewPage(catalog, item), catalog };
}

function ownerRead(actor: ReadActor, client: SupabaseClient | undefined): OwnerRead | undefined {
	if (!canReadLive(actor)) return undefined;
	return {
		accessToken: actor.accessToken,
		owns: (listing) => ownsListing(listing, actor),
		client,
	};
}
