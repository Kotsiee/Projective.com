import { batch, computed, signal } from "@preact/signals";
import {
	type BatchOutcome,
	type CatalogueKind,
	type CatalogueListParams,
	type CataloguePage,
	CONSOLE_DEFAULTS,
	consoleHref,
	type ConsoleUrlState,
	defaultSortDir,
	parseConsoleUrl,
	type ServiceType,
} from "../types/catalogue-types.ts";

/**
 * console-store — the `/catalogue` console's cross-island state (plan §6.4). The console renders four
 * hydration roots (lane, header band, canvas, footer band) that coordinate through these module
 * signals, and the URL is the source of truth for every screen state that matters: {@link consoleUrl}
 * mirrors it, writes go through {@link setConsoleUrl} (`history.pushState` / `replaceState`), and a
 * `popstate` re-reads it. The pure halves — URL merging, list params, the selection reducer — are
 * exported for tests and never touch the DOM.
 */

// #region Pure — URL
const ORIGIN = "https://catalogue.invalid";

/** Every query parameter the console owns; anything else on the address is preserved untouched. */
const CONSOLE_PARAMS: ReadonlySet<string> = new Set([
	"view",
	"type",
	"status",
	"model",
	"category",
	"scope",
	"search",
	"sort",
	"dir",
	"period",
	"client",
	"create",
]);

/** How a URL write lands in the session history. */
export type HistoryMode = "push" | "replace";

/** The canonical form of a console state: what a reload of its own href would parse back to. */
export function canonicalConsoleUrl(state: Partial<ConsoleUrlState>): ConsoleUrlState {
	return parseConsoleUrl(new URL(consoleHref(state), ORIGIN));
}

/**
 * Apply a patch to the console state. A new sort key opens in its natural direction unless the patch
 * names one; a product scope drops the delivery-model facet; the client drawer exists only on the
 * clients view; a closed create modal carries no seed. The result is canonical.
 */
export function mergeConsoleUrl(
	current: ConsoleUrlState,
	patch: Partial<ConsoleUrlState>,
): ConsoleUrlState {
	const next: Partial<ConsoleUrlState> = { ...current, ...patch };
	if (patch.sort && patch.sort !== current.sort && !("dir" in patch)) {
		next.dir = defaultSortDir(patch.sort);
	}
	if (next.type === "product") next.model = [];
	if (next.view !== "clients") next.client = undefined;
	if (!next.createOpen) {
		next.createKind = undefined;
		next.createModel = undefined;
	}
	return canonicalConsoleUrl(next);
}

/**
 * The address for a console state, keeping every parameter the console does not own (a `?tkv=`
 * ticket deep link, say) after the canonical ones.
 */
export function consoleLocation(state: Partial<ConsoleUrlState>, currentSearch = ""): string {
	const href = consoleHref(state);
	const foreign = [...new URLSearchParams(currentSearch)].filter(([key]) =>
		!CONSOLE_PARAMS.has(key)
	);
	if (foreign.length === 0) return href;
	return `${href}${href.includes("?") ? "&" : "?"}${new URLSearchParams(foreign).toString()}`;
}
// #endregion

// #region Pure — listings query
/** The console's icon-only quick filters (session state, not URL state). */
export interface QuickFilters {
	attention: boolean;
	promoted: boolean;
	bestSelling: boolean;
}

/** No quick filter engaged. */
export const NO_QUICK_FILTERS: Readonly<QuickFilters> = {
	attention: false,
	promoted: false,
	bestSelling: false,
};

/** How many listings one console page fetches. */
export const LISTINGS_PAGE_SIZE = 60;

/** The `/api/catalogue/list` params a console state and its quick filters ask for. */
export function listParamsOf(
	state: ConsoleUrlState,
	quick: QuickFilters = NO_QUICK_FILTERS,
	cursor: string | null = null,
): CatalogueListParams {
	return {
		type: state.type,
		status: [...state.status],
		model: state.model.length ? [...state.model] : undefined,
		createCategory: state.create.length ? [...state.create] : undefined,
		search: state.search || undefined,
		sort: state.sort,
		dir: state.dir,
		period: state.period,
		needsAttention: quick.attention || undefined,
		promoted: quick.promoted || undefined,
		bestSelling: quick.bestSelling || undefined,
		cursor,
		limit: LISTINGS_PAGE_SIZE,
	};
}

/** A stable key for the listings read a state asks for — equal keys need no refetch. */
export function listQueryKey(
	state: ConsoleUrlState,
	quick: QuickFilters = NO_QUICK_FILTERS,
): string {
	return JSON.stringify(listParamsOf(state, quick));
}
// #endregion

// #region Pure — selection
/** The batch bar's selection: listing slugs plus the anchor a Shift-click ranges from. */
export interface SelectionState {
	selected: ReadonlySet<string>;
	anchor: string | null;
}

/** A change to the selection. `order` is the listings as currently shown. */
export type SelectionAction =
	| { type: "toggle"; id: string; order: readonly string[]; range?: boolean }
	| { type: "all"; order: readonly string[] }
	| { type: "clear" }
	| { type: "keep"; ids: readonly string[] };

/** The slugs from `from` to `to` inclusive, in shown order; just `to` when either is not shown. */
export function rangeBetween(order: readonly string[], from: string, to: string): string[] {
	const a = order.indexOf(from);
	const b = order.indexOf(to);
	if (a < 0 || b < 0) return [to];
	return order.slice(Math.min(a, b), Math.max(a, b) + 1);
}

/**
 * The selection reducer. A plain toggle flips one listing and moves the anchor to it; a range toggle
 * gives every listing between the anchor and the target the target's new state and keeps the
 * anchor; "all" selects what is shown; "keep" drops anything no longer shown.
 */
export function reduceSelection(state: SelectionState, action: SelectionAction): SelectionState {
	switch (action.type) {
		case "toggle": {
			const on = !state.selected.has(action.id);
			const next = new Set(state.selected);
			if (action.range && state.anchor !== null && action.order.includes(state.anchor)) {
				for (const id of rangeBetween(action.order, state.anchor, action.id)) {
					if (on) next.add(id);
					else next.delete(id);
				}
				return { selected: next, anchor: state.anchor };
			}
			if (on) next.add(action.id);
			else next.delete(action.id);
			return { selected: next, anchor: action.id };
		}
		case "all":
			return { selected: new Set(action.order), anchor: state.anchor };
		case "clear":
			return { selected: new Set(), anchor: null };
		case "keep": {
			const shown = new Set(action.ids);
			const next = new Set([...state.selected].filter((id) => shown.has(id)));
			const anchor = state.anchor !== null && shown.has(state.anchor) ? state.anchor : null;
			return { selected: next, anchor };
		}
	}
}
// #endregion

// #region Signals
/** The console's URL state, hydrated from the address and kept in step with history. */
export const consoleUrl = signal<ConsoleUrlState>({ ...CONSOLE_DEFAULTS });

/** Whether {@link consoleUrl} has been read from the address (until then islands use their SSR props). */
export const consoleReady = signal(false);

/** The search field's raw text; {@link consoleUrl} holds its normalised form. */
export const searchDraft = signal("");

/** The engaged quick filters. */
export const quickFilters = signal<QuickFilters>({ ...NO_QUICK_FILTERS });

/** The listings read so far: the latest page's facts with every loaded page's items. */
export const listingsPage = signal<CataloguePage | null>(null);

/** A listings read is in flight. */
export const listingsBusy = signal(false);

/** The last listings read failure; while set, what is on screen does not answer the query. */
export const listingsError = signal<string | null>(null);

/** The selected listing slugs. */
export const selection = signal<ReadonlySet<string>>(new Set());

/** Where a Shift-click range starts. */
export const selectionAnchor = signal<string | null>(null);

/** How the batch bar names what a run did ("publish" / "published"). */
export interface BatchVerb {
	base: string;
	past: string;
}

/** A batch the footer band ran: whether it is running, what it did, and how each listing fared. */
export interface BatchState {
	running: boolean;
	/** What the last run did. */
	verb: BatchVerb | null;
	results: BatchOutcome[];
	/** The titles of the listings the run acted on, by slug, so a failure can name its listing. */
	titles: Readonly<Record<string, string>>;
	/** Why the whole request was refused, when it never reached the listings. */
	error: string | null;
}

/** The batch bar's last or current run. */
export const batchState = signal<BatchState>({
	running: false,
	verb: null,
	results: [],
	titles: {},
	error: null,
});

/** The rollups the header band reports — the whole catalogue's, not the page's. */
export const rollups = computed(() => listingsPage.value?.stats ?? null);

/** The listing slugs as currently shown, in order. */
export const listingOrder = computed(() => listingsPage.value?.items.map((l) => l.id) ?? []);
// #endregion

// #region History
interface HistoryPort {
	readonly state: unknown;
	pushState(data: unknown, unused: string, url?: string): void;
	replaceState(data: unknown, unused: string, url?: string): void;
}

interface LocationPort {
	readonly href: string;
	readonly pathname: string;
	readonly search: string;
}

function historyPort(): HistoryPort | null {
	return (globalThis as { history?: HistoryPort }).history ?? null;
}

function locationPort(): LocationPort | null {
	return (globalThis as { location?: LocationPort }).location ?? null;
}

/**
 * Fresh's history marker: an entry flagged `fClientNav: true` is replayed as a partial navigation on
 * traversal (partials are off, Decision #52), so every entry the console writes says `false`.
 */
function entryState(history: HistoryPort): Record<string, unknown> {
	const current = history.state;
	const base = current && typeof current === "object" ? current as Record<string, unknown> : {};
	return { ...base, fClientNav: false };
}

function writeLocation(state: ConsoleUrlState, mode: HistoryMode): void {
	const history = historyPort();
	if (!history) return;
	const location = locationPort();
	if (!location) return;
	const next = consoleLocation(state, location.search);
	if (next === location.pathname + location.search) return;
	if (mode === "push") {
		history.replaceState(entryState(history), "", location.pathname + location.search);
		history.pushState(entryState(history), "", next);
	} else {
		history.replaceState(entryState(history), "", next);
	}
}

let syncing = false;

function readLocation(): void {
	const location = locationPort();
	if (!location) return;
	const state = parseConsoleUrl(new URL(location.href));
	batch(() => {
		consoleUrl.value = state;
		searchDraft.value = state.search;
		consoleReady.value = true;
		if (state.view !== "listings") clearSelection();
	});
}

/**
 * Read the console state from the address and follow history from then on. Idempotent: every console
 * island calls it on mount, and only the first call installs the `popstate` listener.
 */
export function startConsoleSync(): void {
	if (syncing) return;
	syncing = true;
	readLocation();
	globalThis.addEventListener?.("popstate", readLocation);
}

/** The state an island renders: the live one once synced, else what the server rendered. */
export function consoleView(initial: ConsoleUrlState): ConsoleUrlState {
	return consoleReady.value ? consoleUrl.value : initial;
}
// #endregion

// #region Actions
/**
 * Change the console state and write it to the address — `push` for a deliberate move a reader may
 * want Back to undo (a view, a facet), `replace` for a stream of edits (typing in the search).
 */
export function setConsoleUrl(patch: Partial<ConsoleUrlState>, mode: HistoryMode = "push"): void {
	const next = mergeConsoleUrl(consoleUrl.peek(), patch);
	batch(() => {
		consoleUrl.value = next;
		if ("search" in patch) searchDraft.value = patch.search ?? "";
		if (next.view !== "listings") clearSelection();
	});
	writeLocation(next, mode);
}

/** Type into the search: the draft keeps every keystroke, the address its normalised form. */
export function setSearch(value: string): void {
	searchDraft.value = value;
	const next = mergeConsoleUrl(consoleUrl.peek(), { search: value });
	if (next.search === consoleUrl.peek().search) return;
	consoleUrl.value = next;
	writeLocation(next, "replace");
}

/** Engage or release one quick filter. */
export function setQuickFilter(key: keyof QuickFilters, on: boolean): void {
	quickFilters.value = { ...quickFilters.peek(), [key]: on };
}

/** Release every quick filter in one write. */
export function clearQuickFilters(): void {
	quickFilters.value = { ...NO_QUICK_FILTERS };
}

function applySelection(action: SelectionAction): void {
	const next = reduceSelection(
		{ selected: selection.peek(), anchor: selectionAnchor.peek() },
		action,
	);
	batch(() => {
		selection.value = next.selected;
		selectionAnchor.value = next.anchor;
	});
}

/** Toggle one listing; `range` (Shift-click) extends from the anchor across what is shown. */
export function toggleSelect(slug: string, range = false): void {
	applySelection({ type: "toggle", id: slug, order: listingOrder.peek(), range });
}

/** Select every listing shown. */
export function selectAll(): void {
	applySelection({ type: "all", order: listingOrder.peek() });
}

/** Empty the selection. */
export function clearSelection(): void {
	if (selection.peek().size === 0 && selectionAnchor.peek() === null) return;
	applySelection({ type: "clear" });
}

/** Drop selected listings that a new read no longer shows. */
export function keepSelection(ids: readonly string[]): void {
	applySelection({ type: "keep", ids });
}

/** Open the quick-create modal, optionally seeded (`?create=`). */
export function openCreate(kind?: CatalogueKind, model?: ServiceType): void {
	setConsoleUrl({
		createOpen: true,
		createKind: kind,
		createModel: kind === "service" ? model : undefined,
	});
}

/** Close the quick-create modal, stripping `?create=` in place. */
export function closeCreate(): void {
	if (!consoleUrl.peek().createOpen) return;
	setConsoleUrl({ createOpen: false }, "replace");
}
// #endregion
