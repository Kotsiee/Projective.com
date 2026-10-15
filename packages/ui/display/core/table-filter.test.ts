import { assertEquals } from "@std/assert";
import type { DataColumn } from "../types/data-table.ts";
import {
	dayEdge,
	filterRowsBy,
	filterSpecOf,
	highlightParts,
	isFilterActive,
	setOptionsOf,
} from "./table-filter.ts";

interface Row {
	id: string;
	name: string;
	bytes: number;
	price: { minor: number; currency: string } | null;
	status: string;
	at: string;
}

const columns: DataColumn<Row>[] = [
	{ id: "name", header: "Name", type: "text", value: (r) => r.name, filter: true },
	{ id: "size", header: "Size", type: "fileSize", value: (r) => r.bytes, filter: true },
	{ id: "price", header: "Price", type: "money", value: (r) => r.price, filter: true },
	{
		id: "status",
		header: "Status",
		type: "status",
		value: (r) => ({ label: r.status, tone: "info" }),
		filter: true,
	},
	{ id: "at", header: "Added", type: "date", value: (r) => r.at, filter: true },
	{ id: "plain", header: "Plain", type: "text", value: (r) => r.id },
];

const MB = 1024 * 1024;
const rows: Row[] = [
	{
		id: "1",
		name: "Brief.pdf",
		bytes: 2 * MB,
		price: { minor: 1500, currency: "GBP" },
		status: "Live",
		at: "2026-03-01T10:00:00",
	},
	{
		id: "2",
		name: "Logo final.png",
		bytes: 12 * MB,
		price: { minor: 99_900, currency: "JPY" },
		status: "Draft",
		at: "2026-03-05T23:30:00",
	},
	{
		id: "3",
		name: "brief notes.txt",
		bytes: 300,
		price: null,
		status: "Live",
		at: "2026-02-20T09:00:00",
	},
];
const idsOf = (list: Row[]) => list.map((r) => r.id);

Deno.test("each type offers its default editor; unflagged columns offer none", () => {
	assertEquals(filterSpecOf(columns[0]), { kind: "text" });
	assertEquals(filterSpecOf(columns[1]), { kind: "range" });
	assertEquals(filterSpecOf(columns[3]), { kind: "set" });
	assertEquals(filterSpecOf(columns[4]), { kind: "dateRange" });
	assertEquals(filterSpecOf(columns[5]), null);
});

Deno.test("text filters match case-insensitive substrings", () => {
	assertEquals(idsOf(filterRowsBy(rows, { name: { kind: "text", query: "BRIEF" } }, columns)), [
		"1",
		"3",
	]);
});

Deno.test("size ranges are in MB", () => {
	assertEquals(idsOf(filterRowsBy(rows, { size: { kind: "range", min: 1, max: 10 } }, columns)), [
		"1",
	]);
});

Deno.test("money ranges are in each currency's major units; an empty amount never matches", () => {
	assertEquals(idsOf(filterRowsBy(rows, { price: { kind: "range", min: 10, max: 20 } }, columns)), [
		"1",
	]);
	assertEquals(
		idsOf(filterRowsBy(rows, { price: { kind: "range", min: 99_000, max: null } }, columns)),
		["2"],
	);
});

Deno.test("set filters keep rows whose value is chosen", () => {
	assertEquals(idsOf(filterRowsBy(rows, { status: { kind: "set", values: ["Live"] } }, columns)), [
		"1",
		"3",
	]);
	assertEquals(setOptionsOf(columns[3], rows), [{ value: "Draft", label: "Draft" }, {
		value: "Live",
		label: "Live",
	}]);
});

Deno.test("date ranges include the whole of both edge days", () => {
	assertEquals(
		idsOf(
			filterRowsBy(
				rows,
				{ at: { kind: "dateRange", from: "2026-03-01", to: "2026-03-05" } },
				columns,
			),
		),
		["1", "2"],
	);
	assertEquals(dayEdge("not a day", "start"), null);
});

Deno.test("filters AND across columns, and inactive filters pass everything", () => {
	assertEquals(
		idsOf(
			filterRowsBy(rows, {
				name: { kind: "text", query: "brief" },
				status: { kind: "set", values: ["Live"] },
				size: { kind: "range", min: null, max: null },
			}, columns),
		),
		["1", "3"],
	);
	assertEquals(isFilterActive({ kind: "text", query: "  " }), false);
});

Deno.test("highlighting splits around every case-insensitive hit", () => {
	assertEquals(highlightParts("Brief brief", "BRIEF"), [
		{ text: "Brief", match: true },
		{ text: " ", match: false },
		{ text: "brief", match: true },
	]);
	assertEquals(highlightParts("Logo", ""), [{ text: "Logo", match: false }]);
});
