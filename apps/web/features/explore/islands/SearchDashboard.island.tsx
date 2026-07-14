import { useSignal } from "@preact/signals";
import { useEffect, useRef } from "preact/hooks";
import type { ComponentChildren, VNode } from "preact";
import { VirtualScroller } from "@projective/ui/display";
import { Button } from "@projective/ui/fields";
import { Drawer } from "@projective/ui/feedback";
import { EmptyState } from "@projective/ui/utils";
import { useMediaQuery } from "@projective/ui/hooks";
import { FilterPanel } from "../components/FilterPanel.tsx";
import { SortControl } from "../components/SortControl.tsx";
import { ResultsHeader } from "../components/ResultsHeader.tsx";
import { ResultsGroupRow } from "../components/ResultsGroupRow.tsx";
import { EntityCard } from "../components/cards/EntityCard.tsx";
import { DetailPanel } from "../components/DetailPanel.tsx";
import { FILTER_CONFIG } from "../core/filter-config.ts";
import { ExploreService } from "../core/ExploreService.ts";
import {
	type ExploreParams,
	parseExploreParams,
	serializeExploreParams,
} from "../core/explore-state.ts";
import type { HrefContext } from "../core/routing.ts";
import type {
	ExploreCategory,
	ExploreEntity,
	ExploreItem,
	SearchPayload,
} from "../types/explore-types.ts";

/** Human title for the Dribbble-style results header when there is no free-text query. */
const CATEGORY_TITLE: Record<ExploreCategory, string> = {
	all: "Everything",
	users: "People & Businesses",
	freelancers: "Freelancers & Teams",
	teams: "Teams",
	businesses: "Businesses",
	services: "Services",
	projects: "Projects",
	products: "Products",
	articles: "Articles",
};

/** A minimal sliders glyph for the filter show/hide toggle. */
function FiltersIcon(): VNode {
	return (
		<svg
			viewBox="0 0 24 24"
			aria-hidden="true"
			fill="none"
			stroke="currentColor"
			stroke-width="1.8"
			stroke-linecap="round"
		>
			<path d="M4 7h16M4 12h16M4 17h16" />
			<circle cx="9" cy="7" r="2.2" fill="currentColor" stroke="none" />
			<circle cx="15" cy="12" r="2.2" fill="currentColor" stroke="none" />
			<circle cx="7" cy="17" r="2.2" fill="currentColor" stroke="none" />
		</svg>
	);
}

/**
 * SearchDashboard — the State B orchestrator (the one heavy island). Owns the results dashboard: a
 * `params` signal synced to the URL (`history.pushState` + `popstate`, so refining is instant and
 * shareable), an adaptive collapsible sidebar (→ an iOS bottom-sheet on mobile), the two feed modes
 * (grouped rows, or a window-scrolled infinite feed for an isolated category), and the split-pane
 * detail drawer. THIN: it holds no discovery logic — first paint comes from the SSR `initial`
 * {@link SearchPayload}, and every refinement/page is fetched from `/api/explore/*` via the dumb
 * {@link ExploreService}. The fat {@link ExploreBackendService} owns all ranking/grouping/paging.
 */

// #region Layout constants
/** Items requested per page in the isolated infinite feed. */
const FEED_PAGE = 18;

/** Estimated card+gap row height (px) per entity, driving VirtualScroller windowing. */
const ROW_HEIGHT: Record<ExploreEntity, number> = {
	users: 470,
	freelancers: 430,
	teams: 430,
	businesses: 470,
	services: 470,
	products: 420,
	articles: 360,
	projects: 300,
};

/** A safe empty payload when SSR data is unexpectedly absent (keeps the island renderable). */
const EMPTY_PAYLOAD: SearchPayload = {
	count: 0,
	isolated: false,
	items: [],
	poolTotal: 0,
	groups: [],
	related: [],
	hasMore: false,
};
// #endregion

export default function SearchDashboard(
	{ initialParams, initial, ctx = { scope: "explore" }, authed = false }: {
		initialParams: ExploreParams;
		initial?: SearchPayload;
		ctx?: HrefContext;
		authed?: boolean;
	},
) {
	const params = useSignal<ExploreParams>(initialParams);
	const payload = useSignal<SearchPayload>(initial ?? EMPTY_PAYLOAD);
	/** Isolated-feed accumulated items (first page from SSR, appended as pages load). */
	const items = useSignal<ExploreItem[]>(initial?.items ?? []);
	const selected = useSignal<ExploreItem | null>(null);
	const drawerOpen = useSignal(false);
	const mobileFilters = useSignal(false);
	/** Desktop-only: whether the filter sidebar is collapsed away (toggled by the icon button). */
	const filtersHidden = useSignal(false);
	/** True only while a feed page is actively being appended — gates the infinite-scroll spinner. */
	const loadingMore = useSignal(false);

	const isMobile = useMediaQuery("(max-width: 767.98px)");
	const isTablet = useMediaQuery("(max-width: 1100px)");

	// #region URL sync + fetching
	/** Fetch a fresh result set for `next` params, optionally pushing a shareable URL. */
	async function runSearch(next: ExploreParams, push: boolean) {
		params.value = next;
		if (push && typeof globalThis.history !== "undefined") {
			globalThis.history.pushState(null, "", serializeExploreParams(next));
		}
		const res = await ExploreService.search(next);
		if (res.ok && res.data) {
			payload.value = res.data;
			items.value = res.data.items;
		}
	}

	/** Commit a refinement: fetch + push a shareable URL. */
	function commit(next: ExploreParams) {
		runSearch(next, true);
	}

	// Keep signals in step with browser back/forward.
	useEffect(() => {
		const onPop = () => runSearch(parseExploreParams(globalThis.location.search), false);
		globalThis.addEventListener("popstate", onPop);
		return () => globalThis.removeEventListener("popstate", onPop);
	}, []);
	// #endregion

	// #region Filter/sort handlers
	function toggleFilter(id: string, value: string) {
		const current = params.value.filters[id] ?? [];
		const nextValues = current.includes(value)
			? current.filter((v) => v !== value)
			: [...current, value];
		commit(withFilter(params.value, id, nextValues));
	}
	function setRange(id: string, value: number) {
		commit(withFilter(params.value, id, [String(value)]));
	}
	function setSelect(id: string, value: string) {
		commit(withFilter(params.value, id, value ? [value] : []));
	}
	function clearFilters() {
		commit({ ...params.value, filters: {} });
	}
	function setSort(value: string) {
		commit({ ...params.value, sort: value });
	}
	// #endregion

	// #region Selection
	function onSelect(item: ExploreItem) {
		selected.value = item;
		drawerOpen.value = true;
	}
	// #endregion

	// #region Infinite feed paging
	/**
	 * Append the next feed page from `/api/explore/search`. Flips `loadingMore` for the duration so the
	 * spinner is mounted ONLY while a page is genuinely in flight. Guards against overlapping loads and
	 * stops when the fat service reports no more pages.
	 */
	async function loadMore() {
		const pl = payload.value;
		if (loadingMore.value || !pl.isolated || !pl.hasMore) return;
		loadingMore.value = true;
		const res = await ExploreService.search(params.value, {
			offset: items.value.length,
			limit: FEED_PAGE,
		});
		if (res.ok && res.data) {
			items.value = [...items.value, ...res.data.items];
			payload.value = { ...pl, hasMore: res.data.hasMore, poolTotal: res.data.poolTotal };
		}
		loadingMore.value = false;
	}
	// #endregion

	// Derived (re-computed on any signal read below).
	const p = params.value;
	const pl = payload.value;
	const filterGroups = FILTER_CONFIG[p.category];
	const activeCount = Object.values(p.filters).reduce((n, arr) => n + arr.length, 0);
	const headTitle = p.q || CATEGORY_TITLE[p.category];
	const showFilters = !isMobile && !filtersHidden.value;

	// A fresh element per call — never share one VNode instance across the sidebar + mobile drawer,
	// or Preact skips the second render (the drawer body would come up empty).
	const renderFilters = () => (
		<FilterPanel
			category={p.category}
			groups={filterGroups}
			values={p.filters}
			onToggle={toggleFilter}
			onSetRange={setRange}
			onSetSelect={setSelect}
			onClear={clearFilters}
			activeCount={activeCount}
		/>
	);

	return (
		<div class="ex-dash">
			<ResultsHeader
				title={headTitle}
				related={pl.related}
				onRelated={(term) => commit({ ...p, q: term })}
			/>

			<div class="ex-dash__bar">
				<p class="ex-dash__count">
					<strong>{pl.count}</strong> {pl.count === 1 ? "result" : "results"}
					{p.q && <span class="ex-muted">for "{p.q}"</span>}
				</p>
				<div class="ex-dash__tools">
					{isMobile
						? (
							<button
								type="button"
								class="ex-dash__filter-btn"
								onClick={() => (mobileFilters.value = true)}
								aria-haspopup="dialog"
							>
								Filters{activeCount > 0 ? ` (${activeCount})` : ""}
							</button>
						)
						: (
							<Button
								variant="text"
								size="sm"
								iconOnly
								icon={<FiltersIcon />}
								badge={activeCount > 0 ? activeCount : undefined}
								aria-label={filtersHidden.value ? "Show filters" : "Hide filters"}
								aria-pressed={!filtersHidden.value}
								class="ex-dash__filter-toggle"
								onClick={() => (filtersHidden.value = !filtersHidden.value)}
							/>
						)}
					<SortControl value={p.sort} onChange={setSort} />
				</div>
			</div>

			<div class={`ex-dash__grid${showFilters ? "" : " ex-dash__grid--nofilters"}`}>
				{showFilters && <aside class="ex-dash__sidebar">{renderFilters()}</aside>}

				<main class="ex-dash__main">
					{pl.count === 0
						? (
							<EmptyState
								title="No results yet"
								description="Try a broader search, clear some filters, or explore a different category."
							/>
						)
						: pl.isolated
						? (
							<UnifiedFeed
								items={items.value}
								type={p.category as ExploreEntity}
								cols={p.category === "projects" ? 1 : isMobile ? 2 : isTablet ? 3 : 5}
								loading={loadingMore.value}
								onReachEnd={loadMore}
								onSelect={onSelect}
								ctx={ctx}
								authed={authed}
							/>
						)
						: (
							<div class="ex-dash__groups">
								{pl.groups.map((g) => (
									<ResultsGroupRow
										key={g.key}
										group={g}
										showAllHref={serializeExploreParams({ ...p, category: g.primary })}
										onSelect={onSelect}
										ctx={ctx}
										authed={authed}
									/>
								))}
							</div>
						)}
				</main>
			</div>

			{isMobile && (
				<Drawer
					visible={mobileFilters}
					position="bottom"
					closable={false}
					size="min(82vh, 40rem)"
					class="ex-sheet"
					onVisibleChange={(v) => (mobileFilters.value = v)}
				>
					<FilterSheet onClose={() => (mobileFilters.value = false)}>
						{renderFilters()}
					</FilterSheet>
				</Drawer>
			)}

			<Drawer
				visible={drawerOpen}
				position="right"
				header={selected.value?.title ?? "Details"}
				size="min(34rem, 96vw)"
				onVisibleChange={(v) => {
					drawerOpen.value = v;
					if (!v) selected.value = null;
				}}
			>
				{selected.value && <DetailPanel item={selected.value} ctx={ctx} />}
			</Drawer>
		</div>
	);
}

// #region Unified virtual feed
/**
 * The isolated single-category feed: window-scrolled + virtualized via the library VirtualScroller.
 * The accumulated `items` (SSR first page + fetched pages) are row-chunked (`cols` per breakpoint)
 * into a uniform grid; only visible rows render. `onReachEnd` requests the next page.
 */
function UnifiedFeed(
	{ items, type, cols, loading, onReachEnd, onSelect, ctx, authed }: {
		items: ExploreItem[];
		type: ExploreEntity;
		cols: number;
		/** Whether a page is actively loading — drives the spinner. */
		loading: boolean;
		onReachEnd: () => void;
		onSelect: (item: ExploreItem) => void;
		ctx: HrefContext;
		authed: boolean;
	},
): VNode {
	const rows: ExploreItem[][] = [];
	for (let i = 0; i < items.length; i += cols) rows.push(items.slice(i, i + cols));
	const rowSize = ROW_HEIGHT[type] ?? 392;

	return (
		<VirtualScroller
			items={rows}
			itemSize={rowSize}
			useWindow
			overscan={3}
			loading={loading}
			onReachEnd={onReachEnd}
			aria-label="Search results"
			class="ex-uni"
			itemTemplate={(row: ExploreItem[]) => (
				<div class="ex-uni__row" style={`--ex-cols:${cols}`}>
					{row.map((it) => (
						<EntityCard key={it.id} item={it} ctx={ctx} onSelect={onSelect} authed={authed} />
					))}
				</div>
			)}
		/>
	);
}
// #endregion

// #region Mobile bottom sheet
/**
 * FilterSheet — the iOS-style bottom-sheet body: a grab-handle bar the user can swipe down to dismiss,
 * a compact title row, and the filter panel below. The swipe transforms the enclosing `.ui-drawer`
 * (found via `closest`) live, then either dismisses past a threshold or springs back. Pointer-based, so
 * it works for touch + mouse; the library still owns the backdrop, focus trap, and reduced-motion.
 */
function FilterSheet(
	{ onClose, children }: { onClose: () => void; children: ComponentChildren },
): VNode {
	const rootRef = useRef<HTMLDivElement>(null);
	const drag = useRef<{ startY: number; dy: number; sheet: HTMLElement | null } | null>(null);

	function sheetEl(): HTMLElement | null {
		return (rootRef.current?.closest(".ui-drawer") as HTMLElement | null) ?? null;
	}
	function onDown(e: PointerEvent) {
		const sheet = sheetEl();
		if (!sheet) return;
		drag.current = { startY: e.clientY, dy: 0, sheet };
		sheet.style.transition = "none";
		(e.currentTarget as HTMLElement).setPointerCapture?.(e.pointerId);
	}
	function onMove(e: PointerEvent) {
		const d = drag.current;
		if (!d?.sheet) return;
		d.dy = Math.max(0, e.clientY - d.startY);
		d.sheet.style.transform = `translateY(${d.dy}px)`;
	}
	function onUp() {
		const d = drag.current;
		drag.current = null;
		if (!d?.sheet) return;
		d.sheet.style.transition = "";
		d.sheet.style.transform = "";
		if (d.dy > 90) onClose();
	}

	return (
		<div class="ex-sheet__inner" ref={rootRef}>
			<div
				class="ex-sheet__grip"
				onPointerDown={onDown}
				onPointerMove={onMove}
				onPointerUp={onUp}
				onPointerCancel={onUp}
			>
				<span class="ex-sheet__handle" aria-hidden="true" />
				<div class="ex-sheet__grip-row">
					<span class="ex-sheet__title">Filters</span>
					<button type="button" class="ex-sheet__done" onClick={onClose}>Done</button>
				</div>
			</div>
			<div class="ex-sheet__body">{children}</div>
		</div>
	);
}
// #endregion

// #region Helpers
/** Immutably set (or delete when empty) one facet's values on an ExploreParams. */
function withFilter(p: ExploreParams, id: string, values: string[]): ExploreParams {
	const filters = { ...p.filters };
	if (values.length) filters[id] = values;
	else delete filters[id];
	return { ...p, filters };
}
// #endregion
