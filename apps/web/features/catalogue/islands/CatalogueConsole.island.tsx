import type { JSX } from "preact";
import { batch, useSignal, useSignalEffect } from "@preact/signals";
import { useEffect, useRef } from "preact/hooks";
import "../styles/console.css";
import "../styles/listing-card.css";
import { useCtrlWheelZoom } from "@web/features/shell/hooks/useCtrlWheelZoom.ts";
import { ListingsCanvas } from "../components/listings/ListingsCanvas.tsx";
import { ClientsCanvas } from "../components/clients/ClientsCanvas.tsx";
import { CatalogueToolbar } from "../components/CatalogueToolbar.tsx";
import { CatalogueFilterDialog, useFilterDialog } from "../components/CatalogueFilterDialog.tsx";
import { appliedFilterCount, facetsOf } from "../core/filter-dialog-model.ts";
import { AnalyticsCanvas } from "../components/analytics/AnalyticsCanvas.tsx";
import { consoleAnalyticsTarget } from "../core/analytics-view.ts";
import CatalogueCreateModal from "./CatalogueCreateModal.island.tsx";
import { CONSOLE_CANVAS_ID } from "../core/catalogue-model.ts";
import { catalogueZoom } from "../core/view-state.ts";
import {
	clearSelection,
	consoleReady,
	consoleUrl,
	consoleView,
	listingOrder,
	listingsError,
	listingsPage,
	listQueryKey,
	selectAll,
	selection,
	setConsoleUrl,
	startConsoleSync,
} from "../core/console-store.ts";
import { reloadListings } from "../core/console-actions.ts";
import {
	type CataloguePage,
	consoleHref,
	type ConsoleUrlState,
	type ConsoleView,
} from "../types/catalogue-types.ts";

/**
 * CatalogueConsole — the `/catalogue` canvas: the sticky {@link CatalogueToolbar}, then a router over
 * the console views (`?view=listings | analytics | clients`), labelled as the panel the header's view
 * tabs control.
 *
 * It owns the listings read. The server's first page arrives as props and seeds the console store;
 * from then on any change to what the URL or the quick filters ask for re-reads — at once for a
 * deliberate change, debounced while the search is being typed. It also owns the selection keys:
 * Ctrl/Cmd-A selects every listing shown, Escape clears the selection. The Analytics and Clients
 * views are placeholders until their builds land.
 *
 * A team's console (`/teams/:handle/catalogue`, Decision #312) is drawn beside the team's own rail
 * rather than the catalogue lane, so the lane's facets move into the toolbar's Filter dialog
 * ({@link CatalogueFilterDialog}); everything else is the same canvas, read as the team.
 */

export interface CatalogueConsoleProps {
	initial: CataloguePage;
	/** Why the first page could not be read — painted as the error state, never as "empty". */
	initialError: string | null;
	url: ConsoleUrlState;
	/** The seller's display currency, narrowed to the selectable set (the create modal's seed). */
	defaultCurrency: string;
}

const SEARCH_DEBOUNCE_MS = 260;

const VIEW_LABEL: Record<ConsoleView, string> = {
	listings: "Listings",
	analytics: "Analytics",
	clients: "Clients",
};

function isTextEntry(target: EventTarget | null): boolean {
	if (!(target instanceof HTMLElement)) return false;
	if (target.isContentEditable) return true;
	if (target instanceof HTMLTextAreaElement || target instanceof HTMLSelectElement) return true;
	return target instanceof HTMLInputElement &&
		!["checkbox", "radio", "button", "submit", "reset"].includes(target.type);
}

function inOverlay(target: EventTarget | null): boolean {
	return target instanceof Element &&
		target.closest("[role='dialog'], [role='menu'], [role='listbox'], [data-ui-portal]") !== null;
}

export default function CatalogueConsole(props: CatalogueConsoleProps): JSX.Element {
	const hydrated = useSignal(false);
	const canvasRef = useRef<HTMLDivElement>(null);
	const lastKey = useRef(listQueryKey(props.url));
	const lastBase = useRef(listQueryKey({ ...props.url, search: "" }));
	const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

	useEffect(() => {
		startConsoleSync();
		batch(() => {
			if (!listingsPage.peek()) {
				listingsPage.value = props.initial;
				listingsError.value = props.initialError;
			}
			hydrated.value = true;
		});
		return () => {
			if (timer.current) clearTimeout(timer.current);
		};
	}, []);

	useSignalEffect(() => {
		const state = consoleUrl.value;
		if (!consoleReady.value || !hydrated.value) return;
		const key = listQueryKey(state);
		if (key === lastKey.current) return;
		const base = listQueryKey({ ...state, search: "" });
		const typing = base === lastBase.current;
		lastKey.current = key;
		lastBase.current = base;
		if (timer.current) clearTimeout(timer.current);
		if (typing) timer.current = setTimeout(() => void reloadListings(), SEARCH_DEBOUNCE_MS);
		else void reloadListings();
	});

	useEffect(() => {
		const onKey = (e: KeyboardEvent) => {
			if (consoleUrl.peek().view !== "listings") return;
			if (isTextEntry(e.target) || inOverlay(e.target)) return;
			if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "a") {
				if (listingOrder.peek().length === 0) return;
				e.preventDefault();
				selectAll();
			} else if (e.key === "Escape" && selection.peek().size > 0 && !e.defaultPrevented) {
				clearSelection();
			}
		};
		document.addEventListener("keydown", onKey);
		return () => document.removeEventListener("keydown", onKey);
	}, []);

	useCtrlWheelZoom(canvasRef, catalogueZoom);

	const filterDialog = useFilterDialog();
	const state = consoleView(props.url);
	const page = listingsPage.value ?? props.initial;
	const error = hydrated.value ? listingsError.value : props.initialError;
	const filters = state.team
		? { control: filterDialog, applied: appliedFilterCount(facetsOf(state)) }
		: undefined;

	return (
		<div
			class="cat-console"
			id={CONSOLE_CANVAS_ID}
			ref={canvasRef}
			role="tabpanel"
			aria-label={VIEW_LABEL[state.view]}
		>
			<CatalogueToolbar state={state} initialTotal={props.initial.total} filters={filters} />
			{state.view === "listings"
				? <ListingsCanvas state={state} page={page} error={error} />
				: state.view === "analytics"
				? (
					<AnalyticsCanvas
						target={consoleAnalyticsTarget(state)}
						period={state.period}
						onPeriod={(period) => setConsoleUrl({ period })}
						idBase="cat-an-console"
						team={state.team}
					/>
				)
				: (
					<ClientsCanvas
						surface="console"
						scope={{ filter: state.scope }}
						chosen={state.client}
						hrefFor={(client) => consoleHref({ ...state, client })}
						emptyAction={{
							label: "Back to listings",
							onPress: () => setConsoleUrl({ view: "listings" }),
						}}
					/>
				)}
			<CatalogueCreateModal defaultCurrency={props.defaultCurrency} />
			{filters && (
				<CatalogueFilterDialog
					control={filterDialog}
					state={state}
					statusCounts={page.statusCounts}
					facetCounts={page.facetCounts}
				/>
			)}
		</div>
	);
}
