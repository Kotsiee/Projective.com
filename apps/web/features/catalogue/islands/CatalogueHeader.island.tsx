import type { JSX } from "preact";
import { useSignal, useSignalEffect } from "@preact/signals";
import { useEffect } from "preact/hooks";
import "../styles/console.css";
import { InputText } from "@projective/ui/fields";
import { Icon } from "@projective/ui/icons";
import { TabMenu } from "@projective/ui/navigation";
import { CatalogueRollups } from "../components/CatalogueRollups.tsx";
import { CONSOLE_CANVAS_ID, countLabel, scopeNoun, TYPE_TABS } from "../core/catalogue-model.ts";
import {
	consoleReady,
	consoleView,
	listingsBusy,
	listingsError,
	listingsPage,
	rollups,
	searchDraft,
	setConsoleUrl,
	setSearch,
	startConsoleSync,
} from "../core/console-store.ts";
import type { CatalogueStats, ConsoleUrlState, ConsoleView } from "../types/catalogue-types.ts";

/**
 * CatalogueHeader — the console's header band: identity (title and how many listings the current
 * view holds), the one search field, the rollup sentence for the whole catalogue, and the view switch
 * (Listings · Analytics · Clients) whose tabs control the canvas. Below the mobile breakpoint, where
 * the lane is hidden, the type segment lands here too. Search writes the URL in place on every
 * keystroke; the canvas debounces its read.
 */

// #region Props
export interface CatalogueHeaderProps {
	url: ConsoleUrlState;
	/** The server's match count, for the first byte. */
	initialTotal: number;
	/** The server's rollups, for the first byte. */
	initialStats: CatalogueStats;
}
// #endregion

const VIEWS: readonly ConsoleView[] = ["listings", "analytics", "clients"];
const VIEW_TABS = [
	{ key: "listings", label: "Listings" },
	{ key: "analytics", label: "Analytics" },
	{ key: "clients", label: "Clients" },
];

export default function CatalogueHeader(props: CatalogueHeaderProps): JSX.Element {
	const state = consoleView(props.url);
	const search = useSignal(props.url.search);
	const tab = useSignal(VIEWS.indexOf(props.url.view));

	useEffect(() => startConsoleSync(), []);

	useSignalEffect(() => {
		if (consoleReady.value) search.value = searchDraft.value;
	});

	useEffect(() => {
		tab.value = VIEWS.indexOf(state.view);
	}, [state.view]);

	const total = listingsPage.value?.total ?? props.initialTotal;
	const stats = rollups.value ?? props.initialStats;
	const noun = scopeNoun(state.type);
	const count = listingsError.value
		? "Couldn’t refresh"
		: listingsBusy.value
		? `Searching ${noun}…`
		: countLabel(total, state.type);

	return (
		<div class="cat-hdr">
			<div class="cat-hdr__ident">
				<h1 class="cat-hdr__title">Catalogue</h1>
				<span class="cat-hdr__count" aria-live="polite">{count}</span>
			</div>

			<div class="cat-hdr__search">
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
						<span class="cat-hdr__searchicon" aria-hidden="true">
							<Icon name="search" />
						</span>
					}
				/>
			</div>

			<div class="cat-hdr__rollups">
				<CatalogueRollups stats={stats} />
			</div>

			<div class="cat-hdr__types" role="group" aria-label="Catalogue type">
				{TYPE_TABS.map((t) => (
					<button
						key={t.value}
						type="button"
						class={state.type === t.value ? "cat-hdr__type cat-hdr__type--on" : "cat-hdr__type"}
						aria-pressed={state.type === t.value}
						onClick={() => setConsoleUrl({ type: t.value })}
					>
						{t.label}
					</button>
				))}
			</div>

			<TabMenu
				class="cat-hdr__views"
				model={VIEW_TABS}
				activeIndex={tab}
				onActiveIndexChange={(i) => {
					const view = VIEWS[i];
					if (view) setConsoleUrl({ view });
				}}
				panelId={CONSOLE_CANVAS_ID}
				aria-label="Catalogue view"
			/>
		</div>
	);
}
