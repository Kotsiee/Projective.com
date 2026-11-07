import { assertEquals, assertThrows } from "@std/assert";
import { utils, write } from "@e965/xlsx";
import {
	looksLikeWorkbook,
	parseWorkbook,
	projectSheet,
	visibleSheetNames,
	WorkbookReadError,
} from "./sheet-read.ts";

const ROOMY = { rows: 1000, columns: 100 };

function workbookBytes(): ArrayBuffer {
	const book = utils.book_new();
	const totals = utils.aoa_to_sheet([
		["Item", "Qty", "Price"],
		["Pens", 3, 1.5],
		["Ink", 2, 7.25],
	]);
	totals["D2"] = { t: "n", v: 4.5, f: "B2*C2" };
	totals["!ref"] = "A1:D3";
	totals["!cols"] = [{ wpx: 200 }, { hidden: true }];
	utils.book_append_sheet(book, totals, "Totals");
	utils.book_append_sheet(book, utils.aoa_to_sheet([["secret"]]), "Hidden");
	utils.book_append_sheet(book, utils.aoa_to_sheet([["notes"]]), "Notes");
	book.Workbook = { Sheets: [{ Hidden: 0 }, { Hidden: 1 }, { Hidden: 0 }] };
	return (write(book, { type: "array", bookType: "xlsx" }) as ArrayBuffer);
}

Deno.test("a workbook flattens to text, formulas and declared widths", () => {
	const book = parseWorkbook(workbookBytes());
	assertEquals(visibleSheetNames(book), ["Totals", "Notes"]);
	const sheet = projectSheet("Totals", book.Sheets["Totals"], ROOMY);
	assertEquals(sheet.rows[0], ["Item", "Qty", "Price"]);
	assertEquals(sheet.rows[1], ["Pens", "3", "1.5", "4.5"]);
	assertEquals(sheet.columns, 4);
	assertEquals(sheet.formulas, { "1:3": "=B2*C2" });
	assertEquals(sheet.widths[0], 200);
	assertEquals(sheet.widths[1], 0);
});

Deno.test("a sheet that starts past A1 keeps its cells where the file put them", () => {
	const sheet = utils.aoa_to_sheet([]);
	utils.sheet_add_aoa(sheet, [["x"]], { origin: "B3" });
	const bytes = (() => {
		const book = utils.book_new();
		utils.book_append_sheet(book, sheet, "S");
		return write(book, { type: "array", bookType: "xlsx" }) as ArrayBuffer;
	})();
	const read = projectSheet("S", parseWorkbook(bytes).Sheets["S"], ROOMY);
	assertEquals(read.rows.length, 3);
	assertEquals(read.rows[2], ["", "x"]);
});

Deno.test("a preview read takes only the first rows of the first sheet", () => {
	const book = parseWorkbook(workbookBytes(), { previewRows: 2 });
	const sheet = projectSheet("Totals", book.Sheets["Totals"], ROOMY);
	assertEquals(sheet.rows.length, 2);
	assertEquals(sheet.rows[1][0], "Pens");
});

Deno.test("a sheet past its ceilings says so, and a stray far cell does not widen it", () => {
	const book = parseWorkbook(workbookBytes());
	const sheet = projectSheet("Totals", book.Sheets["Totals"], { rows: 2, columns: 2 });
	assertEquals(sheet.rows, [["Item", "Qty"], ["Pens", "3"]]);
	assertEquals([sheet.columns, sheet.totalRows, sheet.truncated], [2, 3, true]);
});

Deno.test("an empty sheet has no rows, and is still a sheet", () => {
	const book = parseWorkbook(workbookBytes());
	book.Sheets["Notes"]["!ref"] = undefined;
	assertEquals(projectSheet("Notes", book.Sheets["Notes"], ROOMY).rows, []);
});

Deno.test("noise is refused, rather than opened as a sheet of noise", () => {
	const noise = crypto.getRandomValues(new Uint8Array(4096));
	noise[0] = 0x01;
	const error = assertThrows(() => parseWorkbook(noise.buffer as ArrayBuffer), WorkbookReadError);
	assertEquals(error.failure, "unreadable");
});

Deno.test("every real workbook container gets through, and so does a table saved as .xls", () => {
	const bytes = (...head: number[]) => new Uint8Array(head);
	assertEquals(looksLikeWorkbook(bytes(0x50, 0x4b, 3, 4)), true);
	assertEquals(looksLikeWorkbook(bytes(0xd0, 0xcf, 0x11, 0xe0)), true);
	assertEquals(looksLikeWorkbook(bytes(0x09, 0x08, 0x10, 0x00)), true);
	assertEquals(
		looksLikeWorkbook(new TextEncoder().encode("<table><tr><td>a</td></tr></table>")),
		true,
	);
	assertEquals(looksLikeWorkbook(new TextEncoder().encode("a,b\n1,2\n")), true);
	assertEquals(looksLikeWorkbook(bytes()), false);
});

Deno.test("bytes that are not a workbook are refused in words", () => {
	const junk = new Uint8Array([0x50, 0x4b, 3, 4, 9, 9, 9, 9]).buffer as ArrayBuffer;
	const error = assertThrows(() => parseWorkbook(junk), WorkbookReadError);
	assertEquals(error.failure, "unreadable");
});
