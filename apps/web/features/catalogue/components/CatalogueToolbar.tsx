import type { JSX } from "preact";
import { useSignal, useSignalEffect } from "@preact/signals";
import "@web/features/projects/styles/fx-toolbar.css";
import { Button, InputText, Select } from "@projective/ui/fields";
import { Icon } from "@projective/ui/icons";
import { countLabel, scopeNoun, TYPE_TABS } from "../core/catalogue-model.ts";
import { CatalogueFilterPopover } from "./CatalogueFilterPopover.tsx";
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
import { CatalogueTypeFilter, type ConsoleUrlState } from "../types/catalogue-types.ts";

/**
 * CatalogueToolbar — the console's sticky control bar, the SHARED `.fx-toolbar` the File, Submissions
 * and Members explorers draw, so the four read as one system (Decision #221). On the Listings view the
 * search docks at the start, then the shared Filter popover (facets and sort, the lane's own control),
 * then the type, a bare dropdown (All · Products · Services) that applies to every view. Below
 * `--bp-md`, where the lane and its New listing are hidden, a round New listing button joins the
 * search on its own row. No count is drawn; what the filters match is announced to assistive
 * technology only. Search writes the URL in place on every keystroke; the canvas debounces its read.
 * Where the catalogue lane is drawn (`laned`, `/catalogue`) the search and Filter are the lane's from
 * `--bp-md` up, so the bar shows them only below it; a team catalogue keeps them at every width.
 */

/** Props for {@link CatalogueToolbar}. */
export interface CatalogueToolbarProps {
	state: ConsoleUrlState;
	/** The server's match count, announced until the first client read lands. */
	initialTotal: number;
	/** Whether the catalogue lane carries the search and Filter beside this canvas. */
	laned: boolean;
}

const TYPE_OPTIONS = TYPE_TABS.map((t) => ({ label: t.label, value: t.value }));

export function CatalogueToolbar(
	{ state, initialTotal, laned }: CatalogueToolbarProps,
): JSX.Element {
	const search = useSignal(state.search);

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
		<div
			class={laned ? "fx-toolbar cat-toolbar cat-toolbar--laned" : "fx-toolbar cat-toolbar"}
			role="toolbar"
			aria-label="Catalogue controls"
		>
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
			{listings && (
				<span class="cat-toolbar__filter">
					<CatalogueFilterPopover state={state} onChange={(patch) => setConsoleUrl(patch)} />
				</span>
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
