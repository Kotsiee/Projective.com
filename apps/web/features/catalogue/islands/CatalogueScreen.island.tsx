import type { JSX } from "preact";
import { type Signal, useComputed, useSignal, useSignalEffect } from "@preact/signals";
import { useEffect, useRef } from "preact/hooks";
import "../styles/catalogue.css";
import { VirtualGrid } from "@projective/ui/display";
import { AnalyticsStrip } from "../components/AnalyticsStrip.tsx";
import { type ListingAction, ListingCard } from "../components/ListingCard.tsx";
import { ListingTable } from "../components/ListingTable.tsx";
import { CatalogueIcon, PlusIcon, RetryIcon } from "../components/catalogue-glyphs.tsx";
import { CatalogueService } from "../core/CatalogueService.ts";
import {
	consoleBusy,
	consoleError,
	consoleQuery,
	consoleSort,
	consoleSortDir,
	consoleTotal,
	openCreate,
} from "../core/catalogue-state.ts";
import {
	defaultSortDir,
	kindNoun,
	listingHref,
	publicListingHref,
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
 * CatalogueScreen — the console BODY, and now only the body: the analytics block, then the zoom-driven
 * item collection (a {@link ListingCard} grid via `VirtualGrid` above the centre marker, a
 * {@link ListingTable} below it), then its states.
 *
 * Everything that scoped or acted on that data has moved to the region that owns it — search and the
 * analytics window to the header band, sort and density to the footer band, the type segment to the
 * lane, which already had it. What is left here is viewing and selecting, which is the contract.
 *
 * The body is still the only place that talks to the network, so it publishes what it found —
 * `consoleTotal`, `consoleBusy`, `consoleError` — for the header band to report. That direction
 * matters: a failed fetch must never be able to render as an empty result.
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
/** How many placeholders the loading state draws — enough to fill a viewport, not the whole page. */
const SKELETON_COUNT = 8;
// #endregion

export default function CatalogueScreen(props: CatalogueScreenProps): JSX.Element {
	// #region State
	const items = useSignal<ListingSummary[]>(props.initial.items);
	const stats = useSignal<CatalogueStats>(props.initial.stats);
	const cursor = useSignal<string | null>(props.initial.nextCursor);
	const hasMore = useSignal<boolean>(props.initial.hasMore);
	const loadingMore = useSignal(false);
	const notice = useSignal<string | null>(null);

	const reqId = useRef(0);
	const searchTimer = useRef<number | null>(null);
	const workspaceRef = useRef<HTMLDivElement>(null);
	// Each watcher swallows its own first run — see the priming effect below.
	const searchPrimed = useRef(true);
	const sortPrimed = useRef(true);
	// #endregion

	// #region Fetch
	function baseParams(cur: string | null) {
		return {
			type: props.type,
			search: consoleQuery.value || undefined,
			sort: consoleSort.value,
			dir: consoleSortDir.value,
			cursor: cur,
			limit: 60,
		};
	}

	async function reload(): Promise<void> {
		const my = ++reqId.current;
		consoleBusy.value = true;
		const res = await CatalogueService.list(baseParams(null));
		if (my !== reqId.current) return;
		consoleBusy.value = false;

		if (!res.ok || !res.data) {
			/*
			 * A failure must not look like a result. Previously this branch did not exist: the state was
			 * left untouched, so a 500 rendered the previous list under the new query — sixteen results
			 * for a term that matched none of them — or, if the list happened to be empty, rendered the
			 * "no listings match" empty state for what was actually an outage. Now the list is marked
			 * stale, the empty state is suppressed, and the error offers the retry.
			 */
			consoleError.value = res.message ?? "Couldn't load your catalogue.";
			return;
		}

		consoleError.value = null;
		const page = res.data.page;
		items.value = page.items;
		cursor.value = page.nextCursor;
		hasMore.value = page.hasMore;
		consoleTotal.value = page.total;
		stats.value = page.stats;
	}

	async function loadMore(): Promise<void> {
		if (loadingMore.value || consoleBusy.value || !hasMore.value || !cursor.value) return;
		const my = reqId.current;
		loadingMore.value = true;
		const res = await CatalogueService.list(baseParams(cursor.value));
		loadingMore.value = false;
		if (my !== reqId.current) return;
		if (!res.ok || !res.data) {
			consoleError.value = res.message ?? "Couldn't load more listings.";
			return;
		}
		consoleError.value = null;
		items.value = [...items.value, ...res.data.page.items];
		cursor.value = res.data.page.nextCursor;
		hasMore.value = res.data.page.hasMore;
	}
	// #endregion

	// #region Cross-island: header band search, footer band sort
	/*
	 * Adopt the SSR scope into the shared signals BEFORE either watcher arms, so the header band and
	 * the footer rig start out agreeing with the page that was already painted. Each watcher then
	 * skips its own first run — the data for that state is on screen, so refetching it would be a
	 * round-trip to redraw what is already there.
	 */
	useEffect(() => {
		/*
		 * `consoleQuery` is deliberately NOT primed here. The header band owns the field and primes it;
		 * writing it from a second island means whichever hydrates last wins, and if the seller starts
		 * typing in the gap their first keystrokes are silently discarded. One writer per signal.
		 */
		consoleSort.value = props.initialSort;
		consoleSortDir.value = defaultSortDir(props.initialSort);
		consoleTotal.value = props.initial.total;
		consoleError.value = null;
		consoleBusy.value = false;
	}, []);

	/** Debounced — the header band writes on every keystroke. */
	useSignalEffect(() => {
		consoleQuery.value; // subscribe
		if (searchPrimed.current) {
			searchPrimed.current = false;
			return;
		}
		if (searchTimer.current) clearTimeout(searchTimer.current);
		searchTimer.current = setTimeout(() => void reload(), SEARCH_DEBOUNCE_MS) as unknown as number;
		return () => {
			if (searchTimer.current) clearTimeout(searchTimer.current);
		};
	});

	/** Immediate — a sort choice is one deliberate act, not a stream of keystrokes. */
	useSignalEffect(() => {
		consoleSort.value; // subscribe
		consoleSortDir.value; // subscribe
		if (sortPrimed.current) {
			sortPrimed.current = false;
			return;
		}
		void reload();
	});
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
				else notice.value = res.message ?? "Couldn't duplicate the listing.";
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

	useCtrlWheelZoom(workspaceRef, catalogueZoom);

	const busy = consoleBusy.value;
	const failed = consoleError.value;
	const isEmpty = items.value.length === 0;
	const filtered = consoleQuery.value.trim().length > 0;

	return (
		<div class="cat-console">
			<AnalyticsStrip stats={stats.value} type={props.type} narrowed={filtered} />

			{notice.value && <p class="cat-console__notice" role="alert">{notice.value}</p>}

			<div
				class="cat-workspace"
				ref={workspaceRef}
				aria-busy={busy ? "true" : undefined}
				data-stale={failed ? "true" : undefined}
			>
				{
					/*
					 * The failure notice sits ABOVE the last good list rather than replacing it. A seller who
					 * loses the connection should not also lose sight of their catalogue — what they must lose
					 * is the *claim* that what they see answers the query they just typed, which the notice
					 * says outright and the dimmed list shows.
					 */
				}
				{failed && (
					<CatalogueError
						message={failed}
						stale={!isEmpty}
						onRetry={() => void reload()}
					/>
				)}

				{busy && isEmpty ? <CatalogueSkeleton /> : isEmpty
					? (!failed && (
						<CatalogueEmpty
							filtered={filtered}
							type={props.type}
							onClear={() => (consoleQuery.value = "")}
							onCreate={() => openCreate(props.type === "product" ? "product" : "service")}
						/>
					))
					: (
						<Workspace
							items={items.value}
							sort={consoleSort}
							dir={consoleSortDir}
							onColumnSort={onColumnSort}
							onAction={onAction}
							onReachEnd={loadMore}
						/>
					)}
			</div>
		</div>
	);

	/** The table headers set sort intent on the SAME signals the footer rig binds — one source of truth. */
	function onColumnSort(key: CatalogueSort): void {
		if (consoleSort.value === key) {
			consoleSortDir.value = consoleSortDir.value === "asc" ? "desc" : "asc";
		} else {
			consoleSort.value = key;
			consoleSortDir.value = defaultSortDir(key);
		}
	}
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

// #region Loading
/**
 * The loading state matches the shape of what is arriving, so the layout does not jump when it lands.
 * There was no loading state at all before: `loading` reached a single `aria-busy` attribute and
 * `loadingMore` reached nothing, so between keystroke and result the console was indistinguishable
 * from an idle one.
 */
function CatalogueSkeleton(): JSX.Element {
	const rows = viewMode.value === "grid";
	return (
		<div class={rows ? "cat-skel cat-skel--grid" : "cat-skel cat-skel--list"} aria-hidden="true">
			{Array.from({ length: SKELETON_COUNT }, (_, i) => <div key={i} class="cat-skel__cell" />)}
		</div>
	);
}
// #endregion

// #region Error
/** Names the problem and the recovery, and says plainly when what is on screen is no longer the truth. */
function CatalogueError(
	{ message, stale, onRetry }: { message: string; stale: boolean; onRetry: () => void },
): JSX.Element {
	return (
		<div class="cat-state cat-state--error" role="alert">
			<span class="cat-state__glyph" aria-hidden="true">
				<RetryIcon size={28} />
			</span>
			<p class="cat-state__title">{message}</p>
			<p class="cat-state__note">
				{stale
					? "Your listings are below, from the last successful load — they may not match what you just searched for."
					: "Nothing was lost — your listings are safe, this view just couldn't reach them."}
			</p>
			<button type="button" class="cat-state__cta" onClick={onRetry}>
				<RetryIcon size={16} /> Try again
			</button>
		</div>
	);
}
// #endregion

// #region Empty
function CatalogueEmpty(
	{ filtered, type, onClear, onCreate }: {
		filtered: boolean;
		type: CatalogueTypeFilter;
		onClear: () => void;
		onCreate: () => void;
	},
): JSX.Element {
	const noun = type === "product" ? "product" : type === "service" ? "service" : "listing";

	if (filtered) {
		return (
			<div class="cat-state" role="status">
				<span class="cat-state__glyph" aria-hidden="true">
					<CatalogueIcon size={30} />
				</span>
				<p class="cat-state__title">No {noun}s match “{consoleQuery.value}”</p>
				<p class="cat-state__note">
					Your other {noun}s are still there — this is only the search.
				</p>
				{
					/* The instruction and the control are the same thing now; it used to say "try clearing
				    the search" and give the seller nothing to clear it with. */
				}
				<button type="button" class="cat-state__cta" onClick={onClear}>
					Clear search
				</button>
			</div>
		);
	}

	return (
		<div class="cat-state" role="status">
			<span class="cat-state__glyph" aria-hidden="true">
				<CatalogueIcon size={34} />
			</span>
			<p class="cat-state__title">Create your first {noun}</p>
			<p class="cat-state__note">
				List a {kindNoun(type === "product" ? "product" : "service")}{" "}
				and manage it end to end — draft, price, publish.
			</p>
			<button type="button" class="cat-state__cta cat-state__cta--primary" onClick={onCreate}>
				<PlusIcon size={16} /> New {noun}
			</button>
		</div>
	);
}
// #endregion
