import { assertEquals } from "@std/assert";
import {
	columnLabel,
	compareCells,
	headerCells,
	nextSort,
	parseCsv,
	tableRowOrder,
} from "./csv.ts";

Deno.test("parseCsv: plain records, CRLF and a trailing newline", () => {
	const table = parseCsv("a,b,c\r\n1,2,3\r\n");
	assertEquals(table.rows, [["a", "b", "c"], ["1", "2", "3"]]);
	assertEquals(table.totalRows, 2);
	assertEquals(table.columns, 3);
	assertEquals(table.truncated, false);
});

Deno.test("parseCsv: quoted delimiters, line breaks and doubled quotes", () => {
	const table = parseCsv('name,quote\n"Smith, J","He said ""hi""\nthen left"\n');
	assertEquals(table.rows, [["name", "quote"], ["Smith, J", 'He said "hi"\nthen left']]);
});

Deno.test("parseCsv: empty cells, trailing delimiter and blank lines", () => {
	assertEquals(parseCsv("a,,c\n\n,b,\n").rows, [["a", "", "c"], ["", "b", ""]]);
	assertEquals(parseCsv("a,").rows, [["a", ""]]);
	assertEquals(parseCsv("").rows, []);
	assertEquals(parseCsv('""').rows, [[""]]);
});

Deno.test("parseCsv: lone CR records, BOM and ragged rows", () => {
	const table = parseCsv("﻿x,y\r1\r2,3,4");
	assertEquals(table.rows, [["x", "y"], ["1"], ["2", "3", "4"]]);
	assertEquals(table.columns, 3);
});

Deno.test("parseCsv: tab delimiter keeps commas", () => {
	assertEquals(parseCsv("a,b\tc\n1\t2", { delimiter: "\t" }).rows, [["a,b", "c"], ["1", "2"]]);
});

Deno.test("parseCsv: lenient with an unterminated quote and text after a closing quote", () => {
	assertEquals(parseCsv('"open,ended\nrow').rows, [["open,ended\nrow"]]);
	assertEquals(parseCsv('"a"b,c').rows, [["ab", "c"]]);
});

Deno.test("parseCsv: maxRows keeps counting past the cap", () => {
	const table = parseCsv("1\n2\n3\n4\n", { maxRows: 2 });
	assertEquals(table.rows, [["1"], ["2"]]);
	assertEquals(table.totalRows, 4);
	assertEquals(table.truncated, true);
});

Deno.test("columnLabel is spreadsheet style", () => {
	assertEquals([0, 1, 25, 26, 27, 51, 52, 701, 702].map(columnLabel), [
		"A",
		"B",
		"Z",
		"AA",
		"AB",
		"AZ",
		"BA",
		"ZZ",
		"AAA",
	]);
});

Deno.test("headerCells uses the first record or letters, padded to the width", () => {
	const table = { rows: [["id", " ", "name"], ["1", "2", "3", "4"]], columns: 4 };
	assertEquals(headerCells(table, true), ["id", "B", "name", "D"]);
	assertEquals(headerCells(table, false), ["A", "B", "C", "D"]);
});

Deno.test("nextSort cycles ascending, descending, none", () => {
	const asc = nextSort(null, 2);
	assertEquals(asc, { column: 2, direction: "ascending" });
	const desc = nextSort(asc, 2);
	assertEquals(desc, { column: 2, direction: "descending" });
	assertEquals(nextSort(desc, 2), null);
	assertEquals(nextSort(desc, 0), { column: 0, direction: "ascending" });
});

Deno.test("compareCells: numbers numerically, text naturally, blanks last", () => {
	assertEquals(compareCells("10", "9") > 0, true);
	assertEquals(compareCells("1,200", "950") > 0, true);
	assertEquals(compareCells("file2", "file10") < 0, true);
	assertEquals(compareCells("", "a") > 0, true);
	assertEquals(compareCells("apple", "Apple"), 0);
});

Deno.test("tableRowOrder filters, skips the header and sorts stably with blanks last", () => {
	const rows = [["name", "n"], ["b", "2"], ["a", ""], ["c", "10"], ["a2", "2"]];
	assertEquals(
		tableRowOrder(rows, { firstRowIsHeader: true, filter: "", sort: null }),
		[1, 2, 3, 4],
	);
	assertEquals(
		tableRowOrder(rows, {
			firstRowIsHeader: true,
			filter: "",
			sort: { column: 1, direction: "ascending" },
		}),
		[1, 4, 3, 2],
	);
	assertEquals(
		tableRowOrder(rows, {
			firstRowIsHeader: true,
			filter: "",
			sort: { column: 1, direction: "descending" },
		}),
		[3, 1, 4, 2],
	);
	assertEquals(
		tableRowOrder(rows, { firstRowIsHeader: false, filter: "A", sort: null }),
		[0, 2, 4],
	);
});
