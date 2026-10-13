import type { EntityView, ExploreItem } from "@projective/types/explore";
import { isExploreBackendLive } from "../../core/supabase.ts";
import {
	type Catalog,
	loadCatalog,
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
 */

/** A listing resolved for a write: the item, its composed page, and the catalogue it was read into. */
export interface ResolvedListing {
	item: ExploreItem;
	view: EntityView;
	/** The catalogue the item resolves in — for the subject rows (`blueprintBySlug`, …) behind it. */
	catalog: Catalog;
}

/** Resolve one listing by its item id (`svc-…` / `prd-…`). See the module header for the seam. */
export async function resolveListing(itemId: string): Promise<ResolvedListing | null | undefined> {
	if (isExploreBackendLive()) {
		let base: Catalog | null;
		try {
			base = await loadCatalog();
		} catch {
			// The profile directory is all this read borrows; the last good load serves for that.
			base = peekCatalog();
		}
		if (!base) return undefined;
		try {
			const fresh = await readListing(itemId, base);
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
