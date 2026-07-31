import type { JSX } from "preact";
import { type Signal, useComputed, useSignal } from "@preact/signals";
import { useEffect, useRef } from "preact/hooks";
import "@web/features/projects/styles/fx-toolbar.css";
import "../styles/catalogue.css";
import { VirtualGrid } from "@projective/ui/display";
import { InputText, MultiSelect, SortControl } from "@projective/ui/fields";
import { AnalyticsStrip } from "../components/AnalyticsStrip.tsx";
import { type ListingAction, ListingCard } from "../components/ListingCard.tsx";
import { ListingTable } from "../components/ListingTable.tsx";
import { CatalogueIcon, PlusIcon, SearchIcon } from "../components/catalogue-glyphs.tsx";
import { CatalogueService } from "../core/CatalogueService.ts";
import { type AnalyticsPeriod, analyticsPeriod, openCreate } from "../core/catalogue-state.ts";
import {
	defaultSortDir,
	kindNoun,
	listingHref,
	publicListingHref,
	segmentHref,
	SORT_OPTIONS,
} from "../core/catalogue-model.ts";
import { useCtrlWheelZoom } from "@web/features/shell/hooks/useCtrlWheelZoom.ts";
import { catalogueZoom, gridColWidth, viewMode, zoom } from "../core/view-state.ts";
import type {
	CataloguePage,
	CatalogueSort,
	CatalogueSortDir,
	CatalogueStats,
	CatalogueTypeFilter,
	ListingSummary,
} from "../types/catalogue-types.ts";

/**
 * CatalogueScreen — the console body (the PageCanvas content on `/catalogue`). Header band (underlined
 * segment tabs · search · `SortControl`) → the light KPI {@link AnalyticsStrip} → the zoom-driven
 * item collection (a {@link ListingCard} grid via `VirtualGrid` above the centre marker, a
 * {@link ListingTable} below it — Ctrl+wheel over the workspace drives the zoom, window-virtualized) →
 * an empty state. THIN: first paint from SSR, search/sort refine through the API; type is a full nav so
 * the lane stays in sync. Lifecycle actions (publish/pause/archive/duplicate) go through the thin
 * service and refetch. The zoom rig lives in the middle-nav footer band (a separate island).
 */

// #region Props + constants
export interface CatalogueScreenProps {
	initial: CataloguePage;
	type: CatalogueTypeFilter;
	initialSort: CatalogueSort;
	initialSearch: string;
}

const GRID_GAP = 16;
const CARD_BODY = 116;
const SEARCH_DEBOUNCE_MS = 260;
const PERIODS = ["7d", "30d", "90d"] as const;
/** The toolbar type-scope options — the multi-select facet (`all` = neither/both selected). */
const TYPE_FILTER_OPTIONS = [
	{ value: "product", label: "Products" },
	{ value: "service", label: "Services" },
];
// #endregion

export default function CatalogueScreen(props: CatalogueScreenProps): JSX.Element {
	// #region State
	const items = useSignal<ListingSummary[]>(props.initial.items);
	const stats = useSignal<CatalogueStats>(props.initial.stats);
	const cursor = useSignal<string | null>(props.initial.nextCursor);
	const hasMore = useSignal<boolean>(props.initial.hasMore);
	const total = useSignal<number>(props.initial.total);
	const q = useSignal(props.initialSearch);
	// The toolbar type-scope selection (mirrors `?type=`): `all` → [], else the single kind.
	const typeSel = useSignal<string[]>(props.type === "all" ? [] : [props.type]);
	const sort = useSignal<CatalogueSort>(props.initialSort);
	const dir = useSignal<CatalogueSortDir>(defaultSortDir(props.initialSort));
	const loading = useSignal(false);
	const loadingMore = useSignal(false);
	const notice = useSignal<string | null>(null);

	const reqId = useRef(0);
	const searchTimer = useRef<number | null>(null);
	const workspaceRef = useRef<HTMLDivElement>(null);
	// #endregion

	// #region Fetch
	function baseParams(cur: string | null) {
		return {
			type: props.type,
			search: q.value || undefined,
			sort: sort.value,
			dir: dir.value,
			cursor: cur,
			limit: 60,
		};
	}

	async function reload(): Promise<void> {
		const my = ++reqId.current;
		loading.value = true;
		const res = await CatalogueService.list(baseParams(null));
		if (my !== reqId.current) return;
		loading.value = false;
		if (res.ok && res.data) {
			const page = res.data.page;
			items.value = page.items;
			cursor.value = page.nextCursor;
			hasMore.value = page.hasMore;
			total.value = page.total;
			stats.value = page.stats;
		}
	}

	async function loadMore(): Promise<void> {
		if (loadingMore.value || loading.value || !hasMore.value || !cursor.value) return;
		const my = reqId.current;
		loadingMore.value = true;
		const res = await CatalogueService.list(baseParams(cursor.value));
		loadingMore.value = false;
		if (my !== reqId.current) return;
		if (res.ok && res.data) {
			items.value = [...items.value, ...res.data.page.items];
			cursor.value = res.data.page.nextCursor;
			hasMore.value = res.data.page.hasMore;
		}
	}

	function onSearch(value: string): void {
		q.value = value;
		if (searchTimer.current) clearTimeout(searchTimer.current);
		searchTimer.current = setTimeout(() => void reload(), SEARCH_DEBOUNCE_MS) as unknown as number;
	}

	/** The type-scope multi-select: neither/both → the combined `all` catalogue, else the single kind.
	 * A full navigation (like the retired segment tabs) so the SSR-painted lane stays in sync. */
	function onTypeFilter(next: string[]): void {
		const t: CatalogueTypeFilter = next.length === 1 ? (next[0] as CatalogueTypeFilter) : "all";
		if (t === props.type) return;
		try {
			globalThis.location.assign(segmentHref(t));
		} catch { /* no window */ }
	}

	function onSortKey(key: string): void {
		const k = key as CatalogueSort;
		sort.value = k;
		dir.value = defaultSortDir(k);
		void reload();
	}

	function onSortDir(d: CatalogueSortDir): void {
		dir.value = d;
		void reload();
	}

	/** The table headers set sort intent — same key toggles direction, a new key resets to its default. */
	function onColumnSort(key: CatalogueSort): void {
		if (sort.value === key) dir.value = dir.value === "asc" ? "desc" : "asc";
		else {
			sort.value = key;
			dir.value = defaultSortDir(key);
		}
		void reload();
	}
	// #endregion

	// #region Lifecycle actions
	async function onAction(action: ListingAction, listing: ListingSummary): Promise<void> {
		notice.value = null;
		switch (action) {
			case "edit":
				nav(listingHref(listing.id));
				return;
			case "preview":
				try {
					globalThis.open(publicListingHref(listing), "_blank", "noopener");
				} catch { /* no window */ }
				return;
			case "duplicate": {
				const res = await CatalogueService.create({
					title: `${listing.title} (copy)`,
					kind: listing.kind,
					serviceType: listing.kind === "service" ? listing.serviceType ?? undefined : undefined,
				});
				if (res.ok && res.data) nav(listingHref(res.data.listing.id));
				return;
			}
			case "publish":
			case "pause":
			case "archive":
			case "restore": {
				const target = action === "publish"
					? "published"
					: action === "pause"
					? "paused"
					: action === "archive"
					? "archived"
					: "draft";
				const res = await CatalogueService.setStatus(listing.id, target);
				if (res.ok) void reload();
				else notice.value = res.message ?? "Couldn't update the listing.";
				return;
			}
		}
	}

	function nav(href: string): void {
		try {
			globalThis.location.assign(href);
		} catch { /* no window */ }
	}
	// #endregion

	// #region Effects: restore zoom + Ctrl+wheel
	useCtrlWheelZoom(workspaceRef, catalogueZoom);
	// #endregion

	const isEmpty = items.value.length === 0;
	const noFilters = !q.value;
	const nounPlural = props.type === "service"
		? "services"
		: props.type === "product"
		? "products"
		: "listings";

	return (
		<div class="cat-console">
			<div class="fx-toolbar">
				<div class="fx-toolbar__search">
					<InputText
						value={q}
						onValueChange={onSearch}
						placeholder={`Search ${nounPlural}`}
						type="search"
						variant="bare"
						size="sm"
						block
						aria-label={`Search ${nounPlural}`}
						start={
							<span class="fx-toolbar__searchicon" aria-hidden="true">
								<SearchIcon size={16} />
							</span>
						}
					/>
				</div>
				<span class="fx-toolbar__spacer" />
				<MultiSelect
					class="ui-field--bare"
					size="sm"
					display="chip"
					placeholder="All types"
					aria-label="Filter by type"
					options={TYPE_FILTER_OPTIONS}
					value={typeSel}
					onValueChange={onTypeFilter}
				/>
				<SortControl
					options={[...SORT_OPTIONS]}
					value={sort as Signal<string>}
					direction={dir}
					onValueChange={onSortKey}
					onDirectionChange={onSortDir}
					size="sm"
					aria-label="Sort listings"
				/>
			</div>

			<section class="cat-analytics" aria-label="Catalogue analytics">
				<div class="cat-analytics__head">
					<h2 class="cat-analytics__title">Analytics</h2>
					<PeriodSwitch />
				</div>
				<AnalyticsStrip stats={stats.value} />
			</section>

			{notice.value && <p class="cat-console__notice" role="alert">{notice.value}</p>}

			<div class="cat-console__count" aria-live="polite">
				{total.value} {total.value === 1 ? "listing" : "listings"}
			</div>

			<div class="cat-workspace" ref={workspaceRef} aria-busy={loading.value ? "true" : undefined}>
				{isEmpty
					? (
						<CatalogueEmpty
							filtered={!noFilters}
							type={props.type}
							onCreate={() => openCreate(props.type === "product" ? "product" : "service")}
						/>
					)
					: (
						<Workspace
							items={items.value}
							sort={sort}
							dir={dir}
							onColumnSort={onColumnSort}
							onAction={onAction}
							onReachEnd={loadMore}
						/>
					)}
			</div>
		</div>
	);
}

// #region Workspace (reads zoom/viewMode — split out so the root doesn't re-render on a zoom tick)
interface WorkspaceProps {
	items: ListingSummary[];
	sort: Signal<CatalogueSort>;
	dir: Signal<CatalogueSortDir>;
	onColumnSort: (key: CatalogueSort) => void;
	onAction: (action: ListingAction, listing: ListingSummary) => void;
	onReachEnd: () => void;
}

function Workspace(p: WorkspaceProps): JSX.Element {
	const colWidth = useComputed(() => gridColWidth(zoom.value));
	if (viewMode.value === "grid") {
		return (
			<VirtualGrid
				items={p.items}
				minColWidth={colWidth.value}
				rowHeight={(w) => Math.round(w * 0.62) + CARD_BODY + GRID_GAP}
				gap={GRID_GAP}
				useWindow
				overscan={3}
				onReachEnd={p.onReachEnd}
				getItemKey={(l) => l.id}
				aria-label="Listings"
				itemTemplate={(l) => (
					<ListingCard listing={l} href={listingHref(l.id)} onAction={p.onAction} />
				)}
			/>
		);
	}
	return (
		<ListingTable
			items={p.items}
			sort={p.sort}
			dir={p.dir}
			onSort={p.onColumnSort}
			onReachEnd={p.onReachEnd}
		/>
	);
}
// #endregion

// #region Analytics period switch (relocated here from the lane footer — sits with the KPI widgets)
/** The 7d/30d/90d window the KPI strip reports over — writes the shared `analyticsPeriod` signal that
 * {@link AnalyticsStrip} reads (a cross-island signal). Moved out of the lane footer so the scope switch
 * lives alongside the analytics widgets it drives. */
function PeriodSwitch(): JSX.Element {
	return (
		<div class="cat-period" role="group" aria-label="Analytics period">
			{PERIODS.map((p) => (
				<button
					key={p}
					type="button"
					class="cat-period__btn"
					data-on={analyticsPeriod.value === p ? "true" : undefined}
					aria-pressed={analyticsPeriod.value === p}
					onClick={() => (analyticsPeriod.value = p as AnalyticsPeriod)}
				>
					{p}
				</button>
			))}
		</div>
	);
}
// #endregion

// #region Empty state
function CatalogueEmpty(
	{ filtered, type, onCreate }: {
		filtered: boolean;
		type: CatalogueTypeFilter;
		onCreate: () => void;
	},
): JSX.Element {
	if (filtered) {
		return (
			<div class="cat-empty" role="status">
				<span class="cat-empty__glyph" aria-hidden="true">
					<CatalogueIcon size={30} />
				</span>
				<p class="cat-empty__title">No listings match your search</p>
				<p class="cat-empty__note">Try clearing the search or switching segment.</p>
			</div>
		);
	}
	const noun = type === "product" ? "product" : type === "service" ? "service" : "listing";
	return (
		<div class="cat-empty" role="status">
			<span class="cat-empty__glyph" aria-hidden="true">
				<CatalogueIcon size={34} />
			</span>
			<p class="cat-empty__title">Create your first {noun}</p>
			<p class="cat-empty__note">
				List a {kindNoun(type === "product" ? "product" : "service")}{" "}
				and manage it end to end — draft, price, publish.
			</p>
			<button type="button" class="cat-empty__cta" onClick={onCreate}>
				<PlusIcon size={16} /> New {noun}
			</button>
		</div>
	);
}
// #endregion
