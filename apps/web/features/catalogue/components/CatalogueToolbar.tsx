import type { JSX } from "preact";
import { useSignal, useSignalEffect } from "@preact/signals";
import "@web/features/projects/styles/fx-toolbar.css";
import { Button, InputText, Select, SortControl } from "@projective/ui/fields";
import { Icon } from "@projective/ui/icons";
import { countLabel, scopeNoun, SORT_OPTIONS, TYPE_TABS } from "../core/catalogue-model.ts";
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
 * and Members explorers draw, so the four read as one system (Decision #221). The type is a bare
 * dropdown (All · Products · Services) and applies to every view. On the Listings view it adds the
 * search, how many listings the filters match, the sort and — below `--bp-md`, where the lane and its
 * New listing are hidden — a round New listing button; there the bar wraps, search on its own row.
 * Search writes the URL in place on every keystroke; the canvas debounces its read.
 */

/** Props for {@link CatalogueToolbar}. */
export interface CatalogueToolbarProps {
	state: ConsoleUrlState;
	/** The server's match count, for the first byte. */
	initialTotal: number;
}

const TYPE_OPTIONS = TYPE_TABS.map((t) => ({ label: t.label, value: t.value }));

export function CatalogueToolbar({ state, initialTotal }: CatalogueToolbarProps): JSX.Element {
	const search = useSignal(state.search);
	const sort = useConsoleSort(state);

	useSignalEffect(() => {
		if (consoleReady.value) search.value = searchDraft.value;
	});

	const listings = state.view === "listings";
	const noun = scopeNoun(state.type);
	const total = listingsPage.value?.total ?? initialTotal;
	const count = listingsError.value
		? "Couldn’t refresh"
		: listingsBusy.value
		? `Searching ${noun}…`
		: countLabel(total, state.type);

	return (
		<div class="fx-toolbar cat-toolbar" role="toolbar" aria-label="Catalogue controls">
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
			{listings && <span class="cat-toolbar__count" aria-live="polite">{count}</span>}
			<span class="fx-toolbar__spacer" />
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
		</div>
	);
}
