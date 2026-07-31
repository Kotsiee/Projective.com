import type { JSX } from "preact";
import type { Signal } from "@preact/signals";
import { useRef } from "preact/hooks";
import { useVirtualScroll } from "@projective/ui/hooks";
import { listingHref, statusMeta } from "../core/catalogue-model.ts";
import { listRowHeight, zoom } from "../core/view-state.ts";
import { KindIcon, StarGlyph } from "./catalogue-glyphs.tsx";
import type { CatalogueSort, CatalogueSortDir, ListingSummary } from "../types/catalogue-types.ts";
import { Icon } from "@projective/ui/icons";

/**
 * ListingTable — the console's dense LIST presentation (below the zoom centre marker),
 * window-virtualized. Sortable columns drive the SAME `sort`/`dir` signals the footer rig's
 * `SortControl` binds, so there is one source of truth.
 *
 * **The column set adapts to the space the table is actually given, and it does so in CSS.** It used
 * to be eight fixed tracks summing to 1136px, with a leading `minmax(220px, 1fr)` that cannot shrink
 * below the fixed remainder — so the grid overflowed its container at *every* viewport, including
 * 1512px. Nothing in the ancestor chain scrolls horizontally (they are `overflow: visible` up to the
 * shell frame's `clip`) and `document.scrollWidth` stays below the viewport, so the excess was not
 * clipped into something scrollable: it was destroyed. At 900px that silently deleted Price, Views,
 * Orders, Rating and Edited — five of eight columns, including the one number a seller cannot work
 * without.
 *
 * Every cell is emitted with a `data-col` name and the widths live in `catalogue.css` behind
 * **container queries** on `.cat-table`. Container, not viewport: the table's width depends on whether
 * the lane is expanded, so a viewport breakpoint would be measuring the wrong box. CSS, not a
 * `ResizeObserver`: a measured layout renders all eight columns on the server and reflows on
 * hydration, and it cannot settle at all in a context where frames are not being produced.
 */

interface ColumnDef {
	key: string;
	label: string;
	/** The sort key this column drives, or `null` for a non-sortable column. */
	sort: CatalogueSort | null;
	align?: "end";
}

/**
 * Display order. The drop order — which `catalogue.css` encodes — runs from the least load-bearing
 * inward: Rating → Views → Orders → Type → Edited, so a seller loses decoration long before they lose
 * the name, the status or the price the console exists to show.
 */
const COLUMNS: ColumnDef[] = [
	{ key: "title", label: "Listing", sort: "title" },
	{ key: "status", label: "Status", sort: "status" },
	{ key: "price", label: "Price", sort: "price", align: "end" },
	{ key: "type", label: "Type", sort: null },
	{ key: "edited", label: "Edited", sort: "recent", align: "end" },
	{ key: "views", label: "Views", sort: "views", align: "end" },
	{ key: "orders", label: "Orders", sort: "best-selling", align: "end" },
	{ key: "rating", label: "Rating", sort: "rating", align: "end" },
];

export interface ListingTableProps {
	items: ListingSummary[];
	sort: Signal<CatalogueSort>;
	dir: Signal<CatalogueSortDir>;
	onSort: (key: CatalogueSort) => void;
	onReachEnd?: () => void;
}

export function ListingTable(props: ListingTableProps): JSX.Element {
	const viewportRef = useRef<HTMLDivElement>(null);
	const rowH = listRowHeight(zoom.value);

	const vs = useVirtualScroll({
		count: props.items.length,
		itemSize: rowH,
		useWindow: true,
		parentRef: viewportRef,
		overscan: 8,
		onReachEnd: props.onReachEnd,
		getItemKey: (i) => props.items[i]?.id ?? i,
	});

	return (
		<div
			class="cat-table"
			ref={viewportRef}
			role="table"
			aria-label="Listings"
			aria-rowcount={props.items.length}
		>
			<div class="cat-table__head" role="row">
				{COLUMNS.map((col) => {
					const activeSort = props.sort.value === col.sort;
					return (
						<div
							key={col.key}
							class="cat-th"
							role="columnheader"
							data-col={col.key}
							data-align={col.align}
							aria-sort={col.sort && activeSort
								? (props.dir.value === "asc" ? "ascending" : "descending")
								: undefined}
						>
							{col.sort
								? (
									<button type="button" class="cat-th__btn" onClick={() => props.onSort(col.sort!)}>
										<span>{col.label}</span>
										<Icon
											class="cat-th__ind"
											name={activeSort
												? (props.dir.value === "asc" ? "sort-asc" : "sort-desc")
												: "sort"}
										/>
									</button>
								)
								: <span class="cat-th__label">{col.label}</span>}
						</div>
					);
				})}
			</div>

			<div class="cat-table__body" style={`height:${vs.totalSize}px`}>
				{vs.virtualItems.map((vi) => {
					const l = props.items[vi.index];
					if (!l) return null;
					const meta = statusMeta(l.status);
					const kind = l.kind === "service" ? l.serviceType ?? "Service" : "Product";
					return (
						<a
							key={l.id}
							class="cat-trow"
							href={listingHref(l.id)}
							role="row"
							aria-rowindex={vi.index + 1}
							data-index={vi.index}
							style={`transform:translateY(${vi.start}px);height:${rowH}px`}
						>
							<span class="cat-td cat-td--title" role="cell" data-col="title">
								<span class="cat-trow__thumb" aria-hidden="true">
									{l.cover
										? <img src={l.cover} alt="" loading="lazy" />
										: <KindIcon kind={l.kind} size={16} />}
								</span>
								<span class="cat-trow__name">{l.title}</span>
								{
									/*
									 * When the Type column is dropped for width, its content is not lost — it rejoins
									 * the name as a trailing note (revealed by the same container query that hides the
									 * column). A narrow table should carry less furniture, not less information.
									 */
								}
								<span class="cat-trow__kind">{kind}</span>
							</span>

							<span class="cat-td" role="cell" data-col="status">
								<span class="cat-chip" data-tone={meta.tone}>{meta.label}</span>
							</span>

							<span class="cat-td cat-td--num" role="cell" data-col="price">{l.price.display}</span>

							<span class="cat-td cat-td--muted" role="cell" data-col="type">{kind}</span>

							<span class="cat-td cat-td--muted cat-td--num" role="cell" data-col="edited">
								{l.updatedLabel}
							</span>

							<span class="cat-td cat-td--num" role="cell" data-col="views">
								{l.metrics.views30d}
							</span>

							<span class="cat-td cat-td--num" role="cell" data-col="orders">
								{l.metrics.orders}
							</span>

							<span class="cat-td cat-td--num" role="cell" data-col="rating">
								{l.metrics.avgRating > 0
									? (
										<span class="cat-trow__rating">
											<StarGlyph size={12} filled />
											{l.metrics.avgRating.toFixed(1)}
										</span>
									)
									: "—"}
							</span>
						</a>
					);
				})}
			</div>
		</div>
	);
}
