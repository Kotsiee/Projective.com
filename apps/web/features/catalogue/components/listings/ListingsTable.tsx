import type { JSX } from "preact";
import { computed, type Signal } from "@preact/signals";
import { type DataColumn, DataTable } from "@projective/ui/display";
import type { Severity } from "@projective/ui/fields";
import { Icon } from "@projective/ui/icons";
import { LocalKeys } from "@web/utils/storage-keys.ts";
import { listingHref, statusMeta } from "../../core/catalogue-model.ts";
import type { ListingAction } from "../../core/console-actions.ts";
import { listingMenu } from "../../core/listing-menu.ts";
import { displayZoom, listRowHeight } from "../../core/view-state.ts";
import type {
	CatalogueSort,
	CatalogueSortDir,
	ListingSummary,
} from "../../types/catalogue-types.ts";

/**
 * ListingsTable — the console's dense list (below the zoom centre marker) as a `DataTable` preset.
 * Headers sort through the console URL, so the table, the lane and the footer's sort control share
 * one source of truth; selection binds the console store, so the batch bar follows it. Each row links
 * to the listing's workspace and carries the card's actions on a kebab and on right-click. Columns
 * drop least load-bearing first as the lane narrows the table.
 */
export interface ListingsTableProps {
	items: ListingSummary[];
	sort: CatalogueSort;
	dir: CatalogueSortDir;
	selection: Signal<ReadonlySet<string>>;
	selectionAnchor: Signal<string | null>;
	onSort: (key: CatalogueSort) => void;
	/** The canvas's `requestAction`, which confirms Archive and Delete before running them. */
	onAction: (action: ListingAction, listing: ListingSummary) => void;
	onReachEnd?: () => void;
	loading?: boolean;
}

const STATUS_SEVERITY: Record<ReturnType<typeof statusMeta>["tone"], Severity> = {
	success: "success",
	neutral: "info",
	warning: "warning",
	muted: "secondary",
};

function kindLabel(l: ListingSummary): string {
	return l.kind === "service" ? l.serviceType ?? "Service" : "Product";
}

const LISTING_COLUMNS: readonly DataColumn<ListingSummary>[] = [
	{
		id: "title",
		header: "Listing",
		type: "file",
		sortKey: "title",
		fill: true,
		minWidth: 220,
		pinned: true,
		value: (l) => ({
			name: l.title,
			icon: <Icon name={l.kind === "service" ? "service" : "box"} />,
			thumb: l.cover ? { src: l.cover } : null,
		}),
	},
	{
		id: "status",
		header: "Status",
		type: "status",
		sortKey: "status",
		width: 128,
		priority: 6,
		value: (l) => {
			const meta = statusMeta(l.status);
			return { label: meta.label, tone: STATUS_SEVERITY[meta.tone] };
		},
	},
	{
		id: "price",
		header: "Price",
		type: "text",
		sortKey: "price",
		align: "end",
		width: 136,
		priority: 7,
		value: (l) => l.price.display,
	},
	{
		id: "type",
		header: "Type",
		type: "text",
		sortKey: null,
		width: 132,
		priority: 3,
		value: kindLabel,
	},
	{
		id: "edited",
		header: "Edited",
		type: "date",
		format: "relative",
		sortKey: "recent",
		firstSortDir: "desc",
		align: "end",
		width: 120,
		priority: 4,
		value: (l) => l.updatedAt,
	},
	{
		id: "views",
		header: "Views",
		type: "number",
		sortKey: "views",
		firstSortDir: "desc",
		width: 96,
		priority: 2,
		value: (l) => l.metrics.views,
	},
	{
		id: "orders",
		header: "Orders",
		type: "number",
		sortKey: "best-selling",
		firstSortDir: "desc",
		width: 96,
		priority: 5,
		value: (l) => l.metrics.orders,
	},
	{
		id: "rating",
		header: "Rating",
		type: "rating",
		sortKey: "rating",
		firstSortDir: "desc",
		width: 112,
		priority: 1,
		value: (l) => ({
			average: l.metrics.avgRating > 0 ? l.metrics.avgRating : null,
			count: l.metrics.ratingCount,
		}),
	},
];

const ROW_HEIGHT = computed(() => listRowHeight(displayZoom.value));
const COLUMN_STATE = { key: LocalKeys.CATALOGUE_COLUMNS, version: 1 };
const STICKY_TOP = "var(--cat-chrome, var(--shell-topbar-h, 0px))";

export function ListingsTable(props: ListingsTableProps): JSX.Element {
	return (
		<DataTable
			rows={props.items}
			rowKey={(l) => l.id}
			rowLabel={(l) => l.title}
			columns={LISTING_COLUMNS}
			aria-label="Listings"
			dataMode="server"
			sort={[{ key: props.sort, dir: props.dir }]}
			multiSort={false}
			onSortChange={(next) => props.onSort((next[0]?.key ?? props.sort) as CatalogueSort)}
			selectionMode="multiple"
			selection={props.selection}
			selectionAnchor={props.selectionAnchor}
			rowHref={(l) => listingHref(l.id)}
			rowActions={(l) => listingMenu(l, props.onAction)}
			rowHeight={ROW_HEIGHT}
			thumbnailMinRowHeight={0}
			onReachEnd={props.onReachEnd}
			loadingMore={props.loading}
			columnState={COLUMN_STATE}
			stickyTop={STICKY_TOP}
		/>
	);
}
