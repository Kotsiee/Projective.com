import { assertEquals } from "@std/assert";
import {
	findInPage,
	firstMatchFrom,
	indexPageText,
	matchSpans,
	matchSummary,
	normalizeQuery,
	stepMatch,
} from "./pdf-find.ts";

const INDEX = indexPageText([
	{ str: "The quick", hasEOL: true },
	{ str: "brown fox", hasEOL: false },
	{ str: " jumps over", hasEOL: true },
	{ str: "", hasEOL: false },
	{ str: "the  lazy dog.", hasEOL: false },
]);

Deno.test("indexPageText joins items and treats a line end as a space", () => {
	assertEquals(INDEX.text, "The quick brown fox jumps over the  lazy dog.");
	assertEquals(INDEX.starts, [0, 10, 19, 31, 31]);
	assertEquals(INDEX.lengths, [9, 9, 11, 0, 14]);
});

Deno.test("normalizeQuery trims, collapses and lower-cases", () => {
	assertEquals(normalizeQuery("  Quick   Brown "), "quick brown");
	assertEquals(normalizeQuery("   "), "");
});

Deno.test("findInPage matches case-insensitively across items and whitespace runs", () => {
	assertEquals(findInPage(INDEX, "THE", 2), [
		{ page: 2, start: 0, end: 3 },
		{ page: 2, start: 31, end: 34 },
	]);
	assertEquals(findInPage(INDEX, "quick brown", 0), [{ page: 0, start: 4, end: 15 }]);
	assertEquals(findInPage(INDEX, "the lazy", 0), [{ page: 0, start: 31, end: 40 }]);
	assertEquals(findInPage(INDEX, "cat", 0), []);
	assertEquals(findInPage(INDEX, " ", 0), []);
	assertEquals(findInPage(indexPageText([{ str: "aaaa", hasEOL: false }]), "aa", 0).length, 2);
});

Deno.test("matchSpans maps a match back onto the items it covers", () => {
	assertEquals(matchSpans(INDEX, 4, 15), [
		{ item: 0, from: 4, to: 9 },
		{ item: 1, from: 0, to: 5 },
	]);
	assertEquals(matchSpans(INDEX, 31, 40), [{ item: 4, from: 0, to: 9 }]);
	assertEquals(matchSpans(INDEX, 9, 10), []);
});

Deno.test("firstMatchFrom, stepMatch and matchSummary walk the results", () => {
	const matches = [
		{ page: 0, start: 0, end: 1 },
		{ page: 3, start: 0, end: 1 },
		{ page: 5, start: 0, end: 1 },
	];
	assertEquals(firstMatchFrom(matches, 2), 1);
	assertEquals(firstMatchFrom(matches, 6), 0);
	assertEquals(firstMatchFrom([], 0), -1);
	assertEquals(stepMatch(2, 3, 1), 0);
	assertEquals(stepMatch(0, 3, -1), 2);
	assertEquals(stepMatch(-1, 3, -1), 2);
	assertEquals(stepMatch(0, 0, 1), -1);
	assertEquals(matchSummary(1, 12, false), "2 of 12");
	assertEquals(matchSummary(-1, 4, true), "4…");
	assertEquals(matchSummary(-1, 0, true), "Searching…");
	assertEquals(matchSummary(-1, 0, false), "No matches");
});
