import { assert, assertEquals } from "@std/assert";
import {
	type PageRangeResult,
	parsePageRange,
	PRINT_DPI,
	PRINT_MAX_PIXELS,
	printOrientation,
	printPages,
	printScale,
} from "./pdf-print.ts";

function pages(result: PageRangeResult): number[] {
	if (!result.ok) throw new Error(`expected pages, got "${result.error}"`);
	return result.pages;
}

function refusal(result: PageRangeResult): string {
	if (result.ok) throw new Error(`expected a refusal, got ${result.pages.join(",")}`);
	return result.error;
}

Deno.test("parsePageRange reads pages and ranges in document order", () => {
	assertEquals(pages(parsePageRange("1-3, 7", 10)), [1, 2, 3, 7]);
	assertEquals(pages(parsePageRange("7, 1-3", 10)), [1, 2, 3, 7]);
	assertEquals(pages(parsePageRange("  4  ", 10)), [4]);
	assertEquals(pages(parsePageRange("2-2", 10)), [2]);
});

Deno.test("parsePageRange merges overlaps and skips empty items", () => {
	assertEquals(pages(parsePageRange("1-4, 3-5, 4,,", 10)), [1, 2, 3, 4, 5]);
	assertEquals(pages(parsePageRange("1;3", 10)), [1, 3]);
});

Deno.test("parsePageRange accepts open ranges and dashes", () => {
	assertEquals(pages(parsePageRange("8-", 10)), [8, 9, 10]);
	assertEquals(pages(parsePageRange("-3", 10)), [1, 2, 3]);
	assertEquals(pages(parsePageRange("2–4", 10)), [2, 3, 4]);
	assertEquals(pages(parsePageRange("2 - 4", 10)), [2, 3, 4]);
});

Deno.test("parsePageRange refuses empty, malformed, backwards and out-of-range input", () => {
	assert(refusal(parsePageRange("", 10)).startsWith("Enter the pages"));
	assert(refusal(parsePageRange(" , ", 10)).startsWith("Enter the pages"));
	assert(refusal(parsePageRange("abc", 10)).includes('"abc"'));
	assert(refusal(parsePageRange("1-2-3", 10)).includes("isn't a page or a range"));
	assert(refusal(parsePageRange("-", 10)).includes("isn't a page or a range"));
	assert(refusal(parsePageRange("5-2", 10)).includes("2-5"));
	assert(refusal(parsePageRange("0", 10)).includes("numbered from 1"));
	assert(refusal(parsePageRange("0-3", 10)).includes("numbered from 1"));
	assertEquals(
		refusal(parsePageRange("11", 10)),
		"Page 11 is past the end — this document has 10 pages.",
	);
	assert(refusal(parsePageRange("9-12", 10)).includes("Page 12"));
	assert(refusal(parsePageRange("2", 1)).includes("1 page."));
	assert(refusal(parsePageRange("1", 0)).includes("no pages"));
});

Deno.test("printPages resolves all, current and custom", () => {
	assertEquals(pages(printPages("all", "", 2, 3)), [1, 2, 3]);
	assertEquals(pages(printPages("current", "", 2, 3)), [2]);
	assertEquals(pages(printPages("current", "", 9, 3)), [3]);
	assertEquals(pages(printPages("custom", "1, 3", 2, 3)), [1, 3]);
	assert(!printPages("custom", "", 2, 3).ok);
	assert(!printPages("all", "", 1, 0).ok);
});

Deno.test("printScale follows the DPI and caps huge pages", () => {
	assertEquals(printScale(612, 792, PRINT_DPI.draft), 150 / 72);
	assertEquals(printScale(612, 792, PRINT_DPI.high), 300 / 72);
	const capped = printScale(14400, 14400, PRINT_DPI.high);
	const pixels = (14400 * capped) ** 2;
	assert(capped < 300 / 72);
	assert(Math.abs(pixels - PRINT_MAX_PIXELS) / PRINT_MAX_PIXELS < 1e-9);
});

Deno.test("printOrientation follows the page", () => {
	assertEquals(printOrientation(612, 792), "portrait");
	assertEquals(printOrientation(792, 612), "landscape");
	assertEquals(printOrientation(500, 500), "portrait");
});
