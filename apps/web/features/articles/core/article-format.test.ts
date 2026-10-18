import { assertEquals } from "@std/assert";
import {
	arrangeIndexPage,
	readTimeLabel,
	shortArticleDate,
	updatedAfterPublishing,
} from "./article-format.ts";
import { readFailureStatus } from "./read-status.ts";

/** How the article surfaces word their facts, lay out a page of tiles and fail a read (P6). */

Deno.test("reading time and dates read the same everywhere (UTC)", () => {
	assertEquals(readTimeLabel(8), "8 min read");
	assertEquals(readTimeLabel(0), "1 min read");
	assertEquals(readTimeLabel(4.6), "5 min read");
	assertEquals(shortArticleDate("2026-10-14T08:00:00.000Z"), "14 Oct 2026");
	// Late in the UTC day is still that day, whatever zone the server runs in.
	assertEquals(shortArticleDate("2026-10-14T23:59:00+00:00"), "14 Oct 2026");
	assertEquals(shortArticleDate("not a date"), "not a date");
});

Deno.test("an article reads as updated only when it changed on a later day", () => {
	const at = (publishedAt: string, updatedAt: string) =>
		updatedAfterPublishing({ publishedAt, updatedAt });
	assertEquals(at("2026-10-08T08:00:00.000Z", "2026-10-12T09:30:00.000Z"), true);
	assertEquals(at("2026-10-08T08:00:00.000Z", "2026-10-08T17:00:00.000Z"), false);
	assertEquals(at("2026-10-08T08:00:00.000Z", "2026-10-08T08:00:00.000Z"), false);
});

Deno.test("page 1 leads with one story and two features; later pages are the grid alone", () => {
	assertEquals(arrangeIndexPage([1, 2, 3, 4, 5], 1), { lead: 1, features: [2, 3], grid: [4, 5] });
	assertEquals(arrangeIndexPage([1, 2], 1), { lead: 1, features: [2], grid: [] });
	assertEquals(arrangeIndexPage([1], 1), { lead: 1, features: [], grid: [] });
	assertEquals(arrangeIndexPage([], 1), { lead: null, features: [], grid: [] });
	assertEquals(arrangeIndexPage([7, 8, 9], 2), { lead: null, features: [], grid: [7, 8, 9] });
});

Deno.test("a failed read becomes a 404, a 503 or a 500", () => {
	assertEquals(readFailureStatus(404), 404);
	assertEquals(readFailureStatus(503), 503);
	assertEquals(readFailureStatus(500), 500);
	assertEquals(readFailureStatus(422), 500);
});
