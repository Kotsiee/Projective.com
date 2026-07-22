import { useSignal, useSignalEffect } from "@preact/signals";
import { useEffect, useRef } from "preact/hooks";
import type { ComponentChildren, VNode } from "preact";
import { Grid } from "@projective/ui/layout";
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
import { bridgeCommit, bridgeParams } from "../core/filter-bridge.ts";
import {
	activeFilterCount,
	type ExploreParams,
	parseExploreParams,
	serializeExploreParams,
	withFilter,
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

/**
 * Minimum card track width per entity for the isolated feed's fill grid (library {@link Grid} auto-fit,
 * capped by {@link FEED_MAX_COLS}). The wide banner/talent entities want a roomier floor than the media
 * cards so they never squeeze; below each floor the grid stays fully responsive. Products render as a
 * masonry and projects as a list, so they are absent here.
 */
const FEED_MIN_WIDTH: Partial<Record<ExploreEntity, string>> = {
	users: "20rem",
	freelancers: "20rem",
	teams: "20rem",
	businesses: "20rem",
	services: "18rem",
	articles: "18rem",
};

/** Upper bound on the isolated feed's grid columns — keeps cards comfortably wide on large viewports. */
const FEED_MAX_COLS = 4;

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
	/** True only while a feed page is actively being appended — gates the infinite-scroll spinner. */
	const loadingMore = useSignal(false);

	const isMobile = useMediaQuery("(max-width: 767.98px)");

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

	// #region Filter bridge
	// The facet filters render in the navigation sidebar (guest aside / middle-nav lane) as a separate
	// island. Publish the live params (so the lane reflects state in real time) and this island's commit
	// (so a facet change there fetches through the SAME path) across the shared filter-bridge signals.
	useSignalEffect(() => {
		bridgeParams.value = params.value;
	});
	useEffect(() => {
		bridgeCommit.value = commit;
		return () => {
			bridgeCommit.value = null;
		};
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
	const activeCount = activeFilterCount(p);
	const headTitle = p.q || CATEGORY_TITLE[p.category];

	// A fresh element per call — never share one VNode instance across render locations, or Preact skips
	// the second render (the mobile drawer body would come up empty). Used by the mobile filter sheet;
	// the desktop filters render in the navigation sidebar via the separate ExploreFilterLane island.
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
					{/* Filters live in the navigation sidebar on desktop; mobile (no aside) opens a bottom sheet. */}
					{isMobile && (
						<button
							type="button"
							class="ex-dash__filter-btn"
							onClick={() => (mobileFilters.value = true)}
							aria-haspopup="dialog"
						>
							Filters{activeCount > 0 ? ` (${activeCount})` : ""}
						</button>
					)}
					<SortControl value={p.sort} onChange={setSort} />
				</div>
			</div>

			<div class="ex-dash__grid">
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

// #region Unified feed
/**
 * The isolated single-category feed. Renders the accumulated `items` (SSR first page + fetched pages)
 * with a NATIVE, entity-appropriate layout — a responsive fill grid for card entities, a CSS masonry
 * for products (variable-height cards interlock with no overlap), and a hairline-divided list for
 * projects. Native layout means every card computes its own height, so rows never overlap or strand
 * whitespace (the failure mode of a fixed-row virtual grid). Infinite loading is driven by an
 * IntersectionObserver on a tail sentinel that calls `onReachEnd` (the parent guards + pages).
 */
function UnifiedFeed(
	{ items, type, loading, onReachEnd, onSelect, ctx, authed }: {
		items: ExploreItem[];
		type: ExploreEntity;
		/** Whether a page is actively loading — drives the spinner. */
		loading: boolean;
		onReachEnd: () => void;
		onSelect: (item: ExploreItem) => void;
		ctx: HrefContext;
		authed: boolean;
	},
): VNode {
	const sentinelRef = useRef<HTMLDivElement>(null);

	// Fire `onReachEnd` when the tail sentinel nears the viewport. Re-observes when the handler
	// identity changes; the parent's `loadMore` is idempotent (guards on loading/hasMore).
	useEffect(() => {
		const el = sentinelRef.current;
		if (!el || typeof IntersectionObserver === "undefined") return;
		const io = new IntersectionObserver(
			(entries) => {
				if (entries.some((e) => e.isIntersecting)) onReachEnd();
			},
			{ rootMargin: "800px 0px" },
		);
		io.observe(el);
		return () => io.disconnect();
	}, [onReachEnd]);

	let body: VNode;
	if (type === "products") {
		body = (
			<div class="ex-masonry ex-masonry--feed" role="list" aria-label="Search results">
				{items.map((it) => (
					<div class="ex-masonry__item" role="listitem" key={it.id}>
						<EntityCard item={it} ctx={ctx} onSelect={onSelect} authed={authed} />
					</div>
				))}
			</div>
		);
	} else if (type === "projects") {
		body = (
			<ul class="ex-list" role="list" aria-label="Search results">
				{items.map((it) => (
					<li class="ex-list__item" key={it.id}>
						<EntityCard item={it} ctx={ctx} onSelect={onSelect} authed={authed} />
					</li>
				))}
			</ul>
		);
	} else {
		body = (
			<Grid
				class="ex-feed-grid"
				minChildWidth={FEED_MIN_WIDTH[type] ?? "18rem"}
				maxCols={FEED_MAX_COLS}
				gap={5}
				role="list"
				aria-label="Search results"
			>
				{items.map((it) => (
					<div role="listitem" key={it.id}>
						<EntityCard item={it} ctx={ctx} onSelect={onSelect} authed={authed} />
					</div>
				))}
			</Grid>
		);
	}

	return (
		<div class="ex-uni">
			{body}
			<div ref={sentinelRef} class="ex-uni__sentinel" aria-hidden="true" />
			{loading && (
				<div class="ex-uni__loader" role="status" aria-live="polite">
					<span class="ex-uni__spinner" aria-hidden="true" />
				</div>
			)}
		</div>
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
