import { assertEquals } from "@std/assert";
import {
	dropRecent,
	matchRecent,
	parseRecent,
	pushRecent,
	RECENT_SEARCHES_MAX,
} from "./search-history.ts";

/**
 * The recent-searches list rules. The store is device-local and hand-editable, so the parser must be
 * total, and the list must never hold the same term twice in two casings.
 */

Deno.test("parseRecent — malformed, foreign or empty blobs read as an empty list", () => {
	assertEquals(parseRecent(null), []);
	assertEquals(parseRecent("not json"), []);
	assertEquals(parseRecent('{"q":"x"}'), []);
	assertEquals(parseRecent('["  brand  refresh ", 4, "", "Brand refresh", "figma"]'), [
		"brand refresh",
		"figma",
	]);
});

Deno.test("pushRecent — moves a repeat to the front case-insensitively and caps the list", () => {
	assertEquals(pushRecent(["figma", "Brand"], "brand"), ["brand", "figma"]);
	assertEquals(pushRecent(["figma"], "   "), ["figma"]);
	const full = Array.from({ length: RECENT_SEARCHES_MAX }, (_, i) => `t${i}`);
	const next = pushRecent(full, "new");
	assertEquals(next.length, RECENT_SEARCHES_MAX);
	assertEquals(next[0], "new");
	assertEquals(next.includes(`t${RECENT_SEARCHES_MAX - 1}`), false);
});

Deno.test("dropRecent — removes one term regardless of case", () => {
	assertEquals(dropRecent(["Figma", "brand"], "figma"), ["brand"]);
});

Deno.test("matchRecent — empty input lists everything; typed input keeps prefixes, not the exact term", () => {
	assertEquals(matchRecent(["figma", "film", "brand"], ""), ["figma", "film", "brand"]);
	assertEquals(matchRecent(["figma", "film", "brand"], "fi"), ["figma", "film"]);
	assertEquals(matchRecent(["figma", "film"], "Figma"), []);
});
