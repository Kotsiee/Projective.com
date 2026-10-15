import type { JSX } from "preact";
import { type DataColumn, DataTable } from "@projective/ui/display";
import { KEYWORD_NOTE, type KeywordView, type TopListingView } from "../../core/analytics-view.ts";

/**
 * AnalyticsTables — the two tables on the analytics canvas: the searches a listing appeared in
 * (query · impressions · CTR), and, in console scope, the top listings, each linking to its own
 * Analytics tab. A CTR below its threshold prints a dash with the reason spoken, never 0%. Figures
 * arrive formatted, so only the text columns sort.
 */

const figure = <T,>(id: string, header: string, value: (row: T) => string): DataColumn<T> => ({
	id,
	header,
	type: "custom",
	align: "end",
	width: 128,
	render: (row) => <span class="ui-dt__num">{value(row)}</span>,
});

const KEYWORD_COLUMNS: readonly DataColumn<KeywordView>[] = [
	{
		id: "query",
		header: "Search",
		type: "text",
		fill: true,
		minWidth: 180,
		value: (row) => row.query,
	},
	figure<KeywordView>("impressions", "Impressions", (row) => row.impressions),
	{
		id: "ctr",
		header: "Click-through",
		type: "custom",
		align: "end",
		width: 128,
		render: (row) =>
			row.ctrSufficient ? <span class="ui-dt__num">{row.ctr}</span> : (
				<span>
					<span aria-hidden="true">{row.ctr}</span>
					<span class="ui-visually-hidden">Not enough impressions yet</span>
				</span>
			),
	},
];

/** "Searches you appeared in". */
export function KeywordTable({ rows }: { rows: readonly KeywordView[] }): JSX.Element {
	if (rows.length === 0) {
		return (
			<p class="cat-an__empty">
				No searches have reached the listing often enough to show yet.
				<span class="cat-an__note">{KEYWORD_NOTE}</span>
			</p>
		);
	}
	return (
		<>
			<DataTable
				rows={rows}
				rowKey={(row) => row.query}
				columns={KEYWORD_COLUMNS}
				aria-label="Searches you appeared in"
				virtualize={false}
				columnChooser={false}
				reorderable={false}
			/>
			<p class="cat-an__note">{KEYWORD_NOTE}</p>
		</>
	);
}

const TOP_COLUMNS: readonly DataColumn<TopListingView>[] = [
	{
		id: "title",
		header: "Listing",
		type: "text",
		fill: true,
		minWidth: 200,
		value: (row) => row.title,
	},
	figure<TopListingView>("gross", "Gross", (row) => row.gross),
	figure<TopListingView>("orders", "Orders", (row) => row.orders),
	figure<TopListingView>("views", "Views", (row) => row.views),
	figure<TopListingView>("conversion", "Conversion", (row) => row.conversion),
];

/** The console's "Top listings". */
export function TopListingsTable({ rows }: { rows: readonly TopListingView[] }): JSX.Element {
	if (rows.length === 0) {
		return <p class="cat-an__empty">No listing has been viewed or sold in this window yet.</p>;
	}
	return (
		<DataTable
			rows={rows}
			rowKey={(row) => row.id}
			columns={TOP_COLUMNS}
			aria-label="Top listings"
			rowHref={(row) => row.href}
			virtualize={false}
			columnChooser={false}
			reorderable={false}
		/>
	);
}
