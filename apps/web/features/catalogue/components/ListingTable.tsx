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
 * ListingTable — the console's dense LIST presentation (below the zoom centre marker), window-
 * virtualized. Sortable columns drive the SAME `sort`/`dir` signals the toolbar `SortControl` binds, so
 * there is one source of truth; a header click sets/toggles that column's sort. Each row links to the
 * manage page (the lifecycle actions live there + on the grid cards). Row height grows with the list
 * density. Dumb: it signals sort intent; the island refetches.
 */

interface ColumnDef {
	key: string;
	label: string;
	/** The sort key this column drives, or `null` for a non-sortable column. */
	sort: CatalogueSort | null;
	width: string;
	align?: "end";
}

const COLUMNS: ColumnDef[] = [
	{ key: "title", label: "Listing", sort: null, width: "minmax(220px, 1fr)" },
	{ key: "status", label: "Status", sort: "status", width: "112px" },
	{ key: "type", label: "Type", sort: null, width: "148px" },
	{ key: "price", label: "Price", sort: "price", width: "132px", align: "end" },
	{ key: "views", label: "Views", sort: null, width: "88px", align: "end" },
	{ key: "orders", label: "Orders", sort: "best-selling", width: "88px", align: "end" },
	{ key: "rating", label: "Rating", sort: "rating", width: "92px", align: "end" },
	{ key: "edited", label: "Edited", sort: "recent", width: "160px", align: "end" },
];

const TEMPLATE = COLUMNS.map((c) => c.width).join(" ");

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
			<div class="cat-table__head" role="row" style={`grid-template-columns:${TEMPLATE}`}>
				{COLUMNS.map((col) => {
					const activeSort = props.sort.value === col.sort;
					return (
						<div
							key={col.key}
							class="cat-th"
							role="columnheader"
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
					return (
						<a
							key={l.id}
							class="cat-trow"
							href={listingHref(l.id)}
							role="row"
							data-index={vi.index}
							style={`grid-template-columns:${TEMPLATE};transform:translateY(${vi.start}px);height:${rowH}px`}
						>
							<span class="cat-td cat-td--title" role="cell">
								<span class="cat-trow__thumb" aria-hidden="true">
									{l.cover
										? <img src={l.cover} alt="" loading="lazy" />
										: <KindIcon kind={l.kind} size={16} />}
								</span>
								<span class="cat-trow__name">{l.title}</span>
							</span>
							<span class="cat-td" role="cell">
								<span class="cat-chip" data-tone={meta.tone}>{meta.label}</span>
							</span>
							<span class="cat-td cat-td--muted" role="cell">
								{l.kind === "service" ? l.serviceType ?? "Service" : "Product"}
							</span>
							<span class="cat-td cat-td--num" role="cell">{l.price.display}</span>
							<span class="cat-td cat-td--num" role="cell">{l.metrics.views30d}</span>
							<span class="cat-td cat-td--num" role="cell">{l.metrics.orders}</span>
							<span class="cat-td cat-td--num" role="cell">
								{l.metrics.avgRating > 0
									? (
										<span class="cat-trow__rating">
											<StarGlyph size={12} filled />
											{l.metrics.avgRating.toFixed(1)}
										</span>
									)
									: "—"}
							</span>
							<span class="cat-td cat-td--muted cat-td--num" role="cell">{l.updatedLabel}</span>
						</a>
					);
				})}
			</div>
		</div>
	);
}
