import type { JSX } from "preact";
import { useSignal } from "@preact/signals";
import { useEffect, useRef } from "preact/hooks";
import { useVirtualScroll } from "@projective/ui/hooks";
import { Icon } from "@projective/ui/icons";
import { listingHref, statusMeta } from "../../core/catalogue-model.ts";
import { listRowHeight, zoom } from "../../core/view-state.ts";
import type {
	CatalogueSort,
	CatalogueSortDir,
	ListingSummary,
} from "../../types/catalogue-types.ts";

/**
 * ListingsTable — the console's dense list (below the zoom centre marker), window-virtualized. The
 * column headers sort through the console URL, so the table, the lane and the footer's sort control
 * share one source of truth. Each row carries a checkbox for the batch bar and a stretched link to
 * the workspace; the header's checkbox selects or clears everything loaded.
 *
 * Columns drop by container query on `.cat-table` (the lane's width changes the table's, so a
 * viewport query would measure the wrong box), least load-bearing first. Row positions reach CSS as
 * `--cat-vs-*` custom properties set from refs; until hydration the rows sit in normal flow, which at
 * a uniform row height is the same layout.
 */

interface ColumnDef {
	key: string;
	label: string;
	sort: CatalogueSort | null;
	align?: "end";
}

const COLUMNS: readonly ColumnDef[] = [
	{ key: "title", label: "Listing", sort: "title" },
	{ key: "status", label: "Status", sort: "status" },
	{ key: "price", label: "Price", sort: "price", align: "end" },
	{ key: "type", label: "Type", sort: null },
	{ key: "edited", label: "Edited", sort: "recent", align: "end" },
	{ key: "views", label: "Views", sort: "views", align: "end" },
	{ key: "orders", label: "Orders", sort: "best-selling", align: "end" },
	{ key: "rating", label: "Rating", sort: "rating", align: "end" },
];

export interface ListingsTableProps {
	items: ListingSummary[];
	sort: CatalogueSort;
	dir: CatalogueSortDir;
	selected: ReadonlySet<string>;
	onSort: (key: CatalogueSort) => void;
	onSelect: (listing: ListingSummary, range: boolean) => void;
	onSelectAll: (on: boolean) => void;
	onReachEnd?: () => void;
}

function kindLabel(l: ListingSummary): string {
	return l.kind === "service" ? l.serviceType ?? "Service" : "Product";
}

export function ListingsTable(props: ListingsTableProps): JSX.Element {
	const tableRef = useRef<HTMLDivElement>(null);
	const allRef = useRef<HTMLInputElement>(null);
	const virtual = useSignal(false);
	const rowH = listRowHeight(zoom.value);

	const vs = useVirtualScroll({
		count: props.items.length,
		itemSize: rowH,
		useWindow: true,
		parentRef: tableRef,
		overscan: 8,
		onReachEnd: props.onReachEnd,
		getItemKey: (i) => props.items[i]?.id ?? i,
	});

	const selectedCount = props.items.filter((l) => props.selected.has(l.id)).length;
	const allSelected = props.items.length > 0 && selectedCount === props.items.length;

	useEffect(() => {
		virtual.value = true;
	}, []);

	useEffect(() => {
		const el = tableRef.current;
		if (el) {
			el.style.setProperty("--cat-vs-total", `${vs.totalSize}px`);
			el.style.setProperty("--cat-vs-row", `${rowH}px`);
		}
		if (allRef.current) allRef.current.indeterminate = selectedCount > 0 && !allSelected;
	});

	return (
		<div
			class="cat-table"
			ref={tableRef}
			role="table"
			aria-label="Listings"
			aria-rowcount={props.items.length + 1}
			data-virtual={virtual.value ? "true" : undefined}
		>
			<div class="cat-table__head" role="row" aria-rowindex={1}>
				<div class="cat-table__th cat-table__th--select" role="columnheader" data-col="select">
					<input
						ref={allRef}
						type="checkbox"
						class="cat-table__check"
						checked={allSelected}
						aria-label={allSelected ? "Clear the selection" : "Select every loaded listing"}
						onClick={() => props.onSelectAll(!allSelected)}
					/>
				</div>
				{COLUMNS.map((col) => {
					const active = col.sort !== null && props.sort === col.sort;
					return (
						<div
							key={col.key}
							class={col.align ? "cat-table__th cat-table__th--end" : "cat-table__th"}
							role="columnheader"
							data-col={col.key}
							aria-sort={active ? (props.dir === "asc" ? "ascending" : "descending") : undefined}
						>
							{col.sort
								? (
									<button
										type="button"
										class="cat-table__sort"
										onClick={() => col.sort && props.onSort(col.sort)}
									>
										<span class="cat-table__sortlabel">{col.label}</span>
										<Icon
											class="cat-table__sortmark"
											name={active ? (props.dir === "asc" ? "sort-asc" : "sort-desc") : "sort"}
										/>
									</button>
								)
								: col.label}
						</div>
					);
				})}
			</div>

			<div class="cat-table__body" role="rowgroup">
				{vs.virtualItems.map((vi) => {
					const l = props.items[vi.index];
					if (!l) return null;
					const meta = statusMeta(l.status);
					const selected = props.selected.has(l.id);
					return (
						<div
							key={l.id}
							class={selected ? "cat-trow cat-trow--selected" : "cat-trow"}
							role="row"
							aria-rowindex={vi.index + 2}
							ref={(el: HTMLDivElement | null) =>
								el?.style.setProperty("--cat-vs-start", `${vi.start}px`)}
						>
							<span class="cat-trow__cell cat-trow__cell--select" role="cell" data-col="select">
								<input
									type="checkbox"
									class="cat-table__check"
									checked={selected}
									aria-label={`Select ${l.title}`}
									onClick={(e) => props.onSelect(l, e.shiftKey)}
								/>
							</span>
							<span class="cat-trow__cell cat-trow__cell--title" role="cell" data-col="title">
								<span class="cat-trow__thumb" aria-hidden="true">
									{l.cover
										? <img class="cat-trow__img" src={l.cover} alt="" loading="lazy" />
										: <Icon name={l.kind === "service" ? "service" : "box"} />}
								</span>
								<a class="cat-trow__link" href={listingHref(l.id)}>{l.title}</a>
								<span class="cat-trow__kind">{kindLabel(l)}</span>
							</span>
							<span class="cat-trow__cell" role="cell" data-col="status">
								<span class="cat-trow__status" data-tone={meta.tone}>{meta.label}</span>
							</span>
							<span class="cat-trow__cell cat-trow__cell--num" role="cell" data-col="price">
								{l.price.display}
							</span>
							<span class="cat-trow__cell cat-trow__cell--muted" role="cell" data-col="type">
								{kindLabel(l)}
							</span>
							<span
								class="cat-trow__cell cat-trow__cell--muted cat-trow__cell--num"
								role="cell"
								data-col="edited"
							>
								{l.updatedLabel}
							</span>
							<span class="cat-trow__cell cat-trow__cell--num" role="cell" data-col="views">
								{l.metrics.views.toLocaleString("en-US")}
							</span>
							<span class="cat-trow__cell cat-trow__cell--num" role="cell" data-col="orders">
								{l.metrics.orders.toLocaleString("en-US")}
							</span>
							<span class="cat-trow__cell cat-trow__cell--num" role="cell" data-col="rating">
								{l.metrics.avgRating > 0 ? l.metrics.avgRating.toFixed(1) : "No reviews"}
							</span>
						</div>
					);
				})}
			</div>
		</div>
	);
}
