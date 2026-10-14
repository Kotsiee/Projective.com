import type { JSX } from "preact";
import { Table, type TableColumn } from "@projective/ui/display";
import { KEYWORD_NOTE, type KeywordView, type TopListingView } from "../../core/analytics-view.ts";

/**
 * AnalyticsTables — the two tables on the analytics canvas: the searches a listing appeared in
 * (query · impressions · CTR), and, in console scope, the top listings, each linking to its own
 * Analytics tab. A CTR below its threshold prints a dash with the reason spoken, never 0%.
 */

const KEYWORD_COLUMNS: TableColumn<KeywordView>[] = [
	{ field: "query", header: "Search" },
	{ field: "impressions", header: "Impressions", align: "end", class: "cat-an__num" },
	{
		field: "ctr",
		header: "Click-through",
		align: "end",
		class: "cat-an__num",
		body: (row) =>
			row.ctrSufficient ? row.ctr : (
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
			<Table value={[...rows]} columns={KEYWORD_COLUMNS} dataKey="query" />
			<p class="cat-an__note">{KEYWORD_NOTE}</p>
		</>
	);
}

const TOP_COLUMNS: TableColumn<TopListingView>[] = [
	{
		field: "title",
		header: "Listing",
		body: (row) => <a class="cat-an__link" href={row.href}>{row.title}</a>,
	},
	{ field: "gross", header: "Gross", align: "end", class: "cat-an__num" },
	{ field: "orders", header: "Orders", align: "end", class: "cat-an__num" },
	{ field: "views", header: "Views", align: "end", class: "cat-an__num" },
	{ field: "conversion", header: "Conversion", align: "end", class: "cat-an__num" },
];

/** The console's "Top listings". */
export function TopListingsTable({ rows }: { rows: readonly TopListingView[] }): JSX.Element {
	if (rows.length === 0) {
		return <p class="cat-an__empty">No listing has been viewed or sold in this window yet.</p>;
	}
	return <Table value={[...rows]} columns={TOP_COLUMNS} dataKey="id" />;
}
