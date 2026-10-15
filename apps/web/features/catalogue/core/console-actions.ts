import { batch, signal } from "@preact/signals";
import { workspaceHref } from "../types/catalogue-types.ts";
import { publicListingHref } from "./catalogue-model.ts";
import type { BatchAction, ListingStatus, ListingSummary } from "../types/catalogue-types.ts";
import { CatalogueService } from "./CatalogueService.ts";
import {
	batchState,
	type BatchVerb,
	consoleUrl,
	keepSelection,
	listingsBusy,
	listingsError,
	listingsPage,
	listParamsOf,
	quickFilters,
	selection,
} from "./console-store.ts";

/**
 * console-actions — the console's network half: the listings read and its next pages, the batch
 * bar's run, and one card's lifecycle actions. Each writes its outcome into the console store, so
 * every island that shows it (the canvas, the header count, the footer's batch bar) agrees.
 */

// #region Listings
let readSeq = 0;

/** A next page is in flight. */
export const listingsLoadingMore = signal(false);

/** How a next-page request ended. */
export type PageLoad = "loaded" | "failed" | "superseded" | "idle";

/**
 * Read the first page for the current console state. A newer read supersedes an older one, and a
 * failure is reported as a failure — the list on screen stays, marked stale, never shown as empty.
 */
export async function reloadListings(): Promise<void> {
	const seq = ++readSeq;
	listingsBusy.value = true;
	const res = await CatalogueService.list(listParamsOf(consoleUrl.peek(), quickFilters.peek()));
	if (seq !== readSeq) return;
	batch(() => {
		listingsBusy.value = false;
		if (!res.ok || !res.data) {
			listingsError.value = res.message ?? "Couldn't load your catalogue.";
			return;
		}
		listingsError.value = null;
		listingsPage.value = res.data.page;
		keepSelection(res.data.page.items.map((l) => l.id));
	});
}

/** Append the next page, when there is one and nothing else is reading. */
export async function loadMoreListings(): Promise<PageLoad> {
	const page = listingsPage.peek();
	if (listingsLoadingMore.peek() || listingsBusy.peek() || !page?.hasMore || !page.nextCursor) {
		return "idle";
	}
	const seq = readSeq;
	listingsLoadingMore.value = true;
	const res = await CatalogueService.list(
		listParamsOf(consoleUrl.peek(), quickFilters.peek(), page.nextCursor),
	);
	listingsLoadingMore.value = false;
	if (seq !== readSeq) return "superseded";
	if (!res.ok || !res.data) return "failed";
	listingsPage.value = { ...res.data.page, items: [...page.items, ...res.data.page.items] };
	return "loaded";
}
// #endregion

// #region Batch
/**
 * Run one action over the selection. Listings pass or fail on their own: the successes leave the
 * selection, the failures stay selected (so a retry is one press) and are listed by title.
 */
export async function runBatch(action: BatchAction, verb: BatchVerb): Promise<void> {
	const ids = [...selection.peek()];
	if (ids.length === 0 || batchState.peek().running) return;
	const titles = Object.fromEntries(
		(listingsPage.peek()?.items ?? []).filter((l) => selection.peek().has(l.id)).map((
			l,
		) => [l.id, l.title]),
	);
	batchState.value = { running: true, verb, results: [], titles, error: null };
	const res = await CatalogueService.batch({ ids, ...action });
	if (!res.ok || !res.data) {
		batchState.value = {
			running: false,
			verb,
			results: [],
			titles,
			error: res.message ?? "Couldn't apply that to your listings.",
		};
		return;
	}
	const outcomes = res.data;
	batch(() => {
		batchState.value = { running: false, verb, results: outcomes, titles, error: null };
		keepSelection(outcomes.filter((o) => !o.ok).map((o) => o.id));
	});
	await reloadListings();
}

/** Put the batch bar's last report away. */
export function dismissBatchReport(): void {
	batchState.value = { running: false, verb: null, results: [], titles: {}, error: null };
}
// #endregion

// #region One listing
/** A lifecycle or navigation action dispatched from a card's menu. */
export type ListingAction =
	| "edit"
	| "duplicate"
	| "preview"
	| "publish"
	| "pause"
	| "archive"
	| "restore"
	| "delete";

/** What the canvas does after a card action: say something, go somewhere, or open a new tab. */
export interface ActionOutcome {
	notice?: string;
	navigate?: string;
	openTab?: string;
}

const STATUS_FOR: Partial<Record<ListingAction, ListingStatus>> = {
	publish: "published",
	pause: "paused",
	archive: "archived",
	restore: "draft",
};

/** Perform a card's action; lifecycle changes refresh the listings. */
export async function runListingAction(
	action: ListingAction,
	listing: ListingSummary,
): Promise<ActionOutcome> {
	if (action === "edit") return { navigate: workspaceHref(listing.id, {}) };
	if (action === "preview") return { openTab: publicListingHref(listing) };
	if (action === "duplicate") {
		const res = await CatalogueService.duplicate(listing.id);
		if (res.ok && res.data) return { navigate: workspaceHref(res.data.listing.id, {}) };
		return { notice: res.message ?? "Couldn't duplicate the listing." };
	}
	if (action === "delete") {
		const res = await CatalogueService.remove(listing.id);
		await reloadListings();
		return {
			notice: res.ok
				? `“${listing.title}” deleted.`
				: res.message ?? "Couldn't delete the listing.",
		};
	}
	const status = STATUS_FOR[action];
	if (!status) return {};
	const res = await CatalogueService.setStatus(listing.id, status);
	if (!res.ok) return { notice: res.message ?? "Couldn't update the listing." };
	await reloadListings();
	return {};
}
// #endregion
