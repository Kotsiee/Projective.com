import type { JSX } from "preact";
import { useSignal } from "@preact/signals";
import { InlineNotice } from "@projective/ui/feedback";
import { OFFLINE_NOTICE_TEXT } from "@web/utils/offline.ts";
import { useOfflineStall } from "@web/utils/use-offline-stall.ts";
import { BatchReport } from "../BatchReport.tsx";
import { ConsoleEmpty, ConsoleError, ConsoleSkeleton } from "../ConsoleStates.tsx";
import { ListingsGrid } from "./ListingsGrid.tsx";
import { ListingsTable } from "./ListingsTable.tsx";
import { viewMode } from "../../core/view-state.ts";
import {
	clearSelection,
	listingsBusy,
	listingsError,
	NO_QUICK_FILTERS,
	openCreate,
	quickFilters,
	selectAll,
	selection,
	setConsoleUrl,
	toggleSelect,
} from "../../core/console-store.ts";
import {
	type ListingAction,
	listingsLoadingMore,
	loadMoreListings,
	reloadListings,
	runListingAction,
} from "../../core/console-actions.ts";
import type {
	CataloguePage,
	CatalogueSort,
	ConsoleUrlState,
	ListingSummary,
} from "../../types/catalogue-types.ts";

/**
 * ListingsCanvas — the console's Listings view: the batch report, the read's failure (above the last
 * good list, which dims rather than disappears), and then the listings as cards or rows by zoom, or
 * the loading, empty and offline states in their place. A failed read never renders as "empty": an
 * outage and a search with no results must not look alike.
 */

export interface ListingsCanvasProps {
	state: ConsoleUrlState;
	page: CataloguePage;
	error: string | null;
}

function isFiltered(state: ConsoleUrlState): boolean {
	const quick = quickFilters.value;
	return !!(state.search || state.status || state.model || state.create) ||
		quick.attention || quick.promoted || quick.bestSelling;
}

export function ListingsCanvas({ state, page, error }: ListingsCanvasProps): JSX.Element {
	const notice = useSignal<string | null>(null);
	const stall = useOfflineStall(loadMore);

	async function loadMore(): Promise<void> {
		if (stall.blocked.value) return;
		const result = await loadMoreListings();
		if (result !== "loaded" && result !== "failed") return;
		if (stall.settle(result === "loaded")) return;
		if (result === "failed") listingsError.value = "Couldn't load more listings.";
	}

	async function onAction(action: ListingAction, listing: ListingSummary): Promise<void> {
		notice.value = null;
		const outcome = await runListingAction(action, listing);
		if (outcome.notice) notice.value = outcome.notice;
		if (outcome.openTab) globalThis.open(outcome.openTab, "_blank", "noopener");
		if (outcome.navigate) globalThis.location.assign(outcome.navigate);
	}

	function onSelect(listing: ListingSummary, range: boolean): void {
		toggleSelect(listing.id, range);
	}

	function onSort(key: CatalogueSort): void {
		if (key === state.sort) setConsoleUrl({ dir: state.dir === "asc" ? "desc" : "asc" });
		else setConsoleUrl({ sort: key });
	}

	function clearFilters(): void {
		quickFilters.value = { ...NO_QUICK_FILTERS };
		setConsoleUrl({ search: "", status: undefined, model: undefined, create: undefined });
	}

	const busy = listingsBusy.value;
	const items = page.items;
	const empty = items.length === 0;
	const grid = viewMode.value === "grid";

	let body: JSX.Element | null;
	if (busy && empty) body = <ConsoleSkeleton grid={grid} />;
	else if (empty) {
		body = error ? null : (
			<ConsoleEmpty
				filtered={isFiltered(state)}
				type={state.type}
				onClear={clearFilters}
				onCreate={() => openCreate(state.type === "all" ? undefined : state.type)}
			/>
		);
	} else if (grid) {
		body = (
			<ListingsGrid
				items={items}
				selected={selection.value}
				loading={listingsLoadingMore.value}
				onSelect={onSelect}
				onAction={(action, listing) => void onAction(action, listing)}
				onReachEnd={() => void loadMore()}
			/>
		);
	} else {
		body = (
			<ListingsTable
				items={items}
				sort={state.sort}
				dir={state.dir}
				selected={selection.value}
				onSort={onSort}
				onSelect={onSelect}
				onSelectAll={(on) => (on ? selectAll() : clearSelection())}
				onReachEnd={() => void loadMore()}
			/>
		);
	}

	return (
		<div
			class={error ? "cat-console__listings cat-console__listings--stale" : "cat-console__listings"}
			aria-busy={busy ? "true" : undefined}
		>
			<BatchReport />
			{notice.value && (
				<InlineNotice
					class="cat-console__notice"
					align="start"
					assertive
					text={notice.value}
					actionLabel="Dismiss"
					onAction={() => (notice.value = null)}
				/>
			)}
			{error && (
				<ConsoleError
					message={error}
					stale={!empty}
					onRetry={() => void reloadListings()}
				/>
			)}
			{body}
			{stall.stalled.value && (
				<InlineNotice
					text={OFFLINE_NOTICE_TEXT}
					actionLabel="Retry"
					onAction={stall.retry}
					busy={stall.retrying.value}
				/>
			)}
		</div>
	);
}
