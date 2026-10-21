import type { JSX } from "preact";
import { useSignal, useSignalEffect } from "@preact/signals";
import "@web/features/projects/styles/fx-toolbar.css";
import "../styles/filter-dialog.css";
import { Button, InputText, Select, SortControl } from "@projective/ui/fields";
import { Tooltip } from "@projective/ui/feedback";
import { Icon } from "@projective/ui/icons";
import { countLabel, scopeNoun, SORT_OPTIONS, TYPE_TABS } from "../core/catalogue-model.ts";
import { filterButtonLabel } from "../core/filter-dialog-model.ts";
import type { FilterDialogControl } from "./CatalogueFilterDialog.tsx";
import {
	consoleReady,
	listingsBusy,
	listingsError,
	listingsPage,
	openCreate,
	searchDraft,
	setConsoleUrl,
	setSearch,
} from "../core/console-store.ts";
import { useConsoleSort } from "../hooks/useConsoleSort.ts";
import { CatalogueTypeFilter, type ConsoleUrlState } from "../types/catalogue-types.ts";

/**
 * CatalogueToolbar — the console's sticky control bar, the SHARED `.fx-toolbar` the File, Submissions
 * and Members explorers draw, so the four read as one system (Decision #221). On the Listings view the
 * search docks at the start; the type, a bare dropdown (All · Products · Services) that applies to
 * every view, sits at the end directly beside the sort, as the team roster's filter does (#307).
 * Below `--bp-md`, where the lane and its New listing are hidden, a round New listing button joins the
 * search on its own row. No count is drawn; what the filters match is announced to assistive
 * technology only. Search writes the URL in place on every keystroke; the canvas debounces its read.
 * A console drawn without the lane (the team catalogue, Decision #312) passes `filters`, and the bar
 * gains an icon-only Filter button before the type that opens the lane's facets as a dialog, with a
 * dot while any facet narrows the listings.
 */

/** The filter dialog the toolbar's Filter button opens, and how many facets are applied. */
export interface ToolbarFilters {
	control: FilterDialogControl;
	applied: number;
}

/** Props for {@link CatalogueToolbar}. */
export interface CatalogueToolbarProps {
	state: ConsoleUrlState;
	/** The server's match count, announced until the first client read lands. */
	initialTotal: number;
	/** The filter dialog, for a console with no lane to hold the facets. */
	filters?: ToolbarFilters;
}

const TYPE_OPTIONS = TYPE_TABS.map((t) => ({ label: t.label, value: t.value }));

export function CatalogueToolbar(
	{ state, initialTotal, filters }: CatalogueToolbarProps,
): JSX.Element {
	const search = useSignal(state.search);
	const sort = useConsoleSort(state);

	useSignalEffect(() => {
		if (consoleReady.value) search.value = searchDraft.value;
	});

	const listings = state.view === "listings";
	const noun = scopeNoun(state.type);
	const total = listingsPage.value?.total ?? initialTotal;
	const announcement = listingsError.value
		? "Couldn’t refresh"
		: listingsBusy.value
		? `Searching ${noun}…`
		: countLabel(total, state.type);

	return (
		<div class="fx-toolbar cat-toolbar" role="toolbar" aria-label="Catalogue controls">
			{listings && (
				<div class="fx-toolbar__search">
					<InputText
						value={search}
						onValueChange={setSearch}
						placeholder={`Search ${noun}`}
						type="search"
						variant="bare"
						size="sm"
						block
						aria-label={`Search ${noun}`}
						start={
							<span class="fx-toolbar__searchicon" aria-hidden="true">
								<Icon name="search" />
							</span>
						}
					/>
				</div>
			)}
			<span class="fx-toolbar__spacer" />
			{listings && filters && (
				<Tooltip content="Filter listings" placement="bottom">
					<button
						type="button"
						class="cat-toolbar__filter"
						data-on={filters.applied > 0 ? "true" : undefined}
						aria-label={filterButtonLabel(filters.applied)}
						aria-haspopup="dialog"
						aria-expanded={filters.control.visible.value}
						onClick={() => filters.control.open(state)}
					>
						<Icon name="filter" />
						{filters.applied > 0 && <span class="cat-toolbar__filterdot" aria-hidden="true" />}
					</button>
				</Tooltip>
			)}
			<Select
				class="ui-field--bare cat-toolbar__type"
				size="sm"
				aria-label="Catalogue type"
				options={TYPE_OPTIONS}
				value={state.type}
				onValueChange={(value) => {
					const type = CatalogueTypeFilter.safeParse(value);
					if (type.success && type.data !== state.type) setConsoleUrl({ type: type.data });
				}}
			/>
			{listings && (
				<SortControl
					options={[...SORT_OPTIONS]}
					value={sort.sort}
					direction={sort.dir}
					onValueChange={sort.onSort}
					onDirectionChange={sort.onDir}
					size="sm"
					aria-label="Sort listings"
				/>
			)}
			<Button
				size="sm"
				rounded
				iconOnly
				class="cat-toolbar__new"
				aria-label="New listing"
				icon={<Icon name="plus" />}
				onClick={() => openCreate(state.type === "all" ? undefined : state.type)}
			/>
			{listings && <p class="ui-visually-hidden" role="status">{announcement}</p>}
		</div>
	);
}
