import { assertEquals } from "@std/assert";
import {
	type FindableMessage,
	findAnnouncement,
	findMatches,
	findPattern,
	findSummary,
	matchRuns,
	needsEarlier,
	stepMatch,
} from "./chat-find.ts";

const msg = (
	id: string,
	text: string,
	type: FindableMessage["type"] = "user",
): FindableMessage => ({
	id,
	type,
	text,
});

const pattern = (query: string): RegExp => {
	const built = findPattern(query);
	if (!built) throw new Error(`no pattern for "${query}"`);
	return built;
};

Deno.test("findPattern — blank is no search; the query is literal and case-insensitive", () => {
	assertEquals(findPattern(""), null);
	assertEquals(findPattern("   "), null);
	assertEquals(findPattern("Stage")?.test("the stage is funded"), true);
	assertEquals(findPattern("$5 (net)")?.test("costs $5 (net) now"), true);
	assertEquals(findPattern("a.c")?.test("abc"), false);
	assertEquals(findPattern("  draft  ")?.test("Draft v2"), true);
});

Deno.test("matchRuns — every non-overlapping run, in order", () => {
	assertEquals(matchRuns("ab xAB ab", pattern("ab")), [[0, 2], [4, 6], [7, 9]]);
	assertEquals(matchRuns("none here", pattern("ab")), []);
	assertEquals(matchRuns("aaa", pattern("aa")), [[0, 2]]);
});

Deno.test("findMatches — authored messages newest first; system notices never match", () => {
	const thread = [
		msg("m1", "Kick-off notes"),
		msg("s1", "notes were pinned", "system"),
		msg("m2", "no match"),
		msg("m3", "Revised NOTES attached"),
	];
	assertEquals(findMatches(thread, "notes"), ["m3", "m1"]);
	assertEquals(findMatches(thread, ""), []);
	assertEquals(findMatches(thread, "absent"), []);
});

Deno.test("stepMatch — older is +1, newer is -1, wrapping; a stale or missing active lands on the newest", () => {
	const matches = ["new", "mid", "old"];
	assertEquals(stepMatch(matches, "new", 1), "mid");
	assertEquals(stepMatch(matches, "old", 1), "new");
	assertEquals(stepMatch(matches, "new", -1), "old");
	assertEquals(stepMatch(matches, "mid", -1), "new");
	assertEquals(stepMatch(matches, null, 1), "new");
	assertEquals(stepMatch(matches, "gone", -1), "new");
	assertEquals(stepMatch([], null, 1), null);
});

Deno.test("needsEarlier — only stepping past the oldest loaded match while history remains", () => {
	assertEquals(needsEarlier(["a", "b"], "b", true), true);
	assertEquals(needsEarlier([], null, true), true);
	assertEquals(needsEarlier(["a", "b"], "a", true), false);
	assertEquals(needsEarlier(["a", "b"], "b", false), false);
	assertEquals(needsEarlier([], null, false), false);
});

Deno.test("findSummary — position of total, + while earlier history is unsearched", () => {
	assertEquals(findSummary({ active: 2, total: 12, more: false }), "3 of 12");
	assertEquals(findSummary({ active: 0, total: 4, more: true }), "1 of 4+");
	assertEquals(findSummary({ active: -1, total: 4, more: false }), "1 of 4");
	assertEquals(findSummary({ active: -1, total: 0, more: true }), "No matches");
});

Deno.test("findAnnouncement — words for the live region, naming unsearched history", () => {
	assertEquals(findAnnouncement({ active: 0, total: 3, more: false }), "Match 1 of 3.");
	assertEquals(
		findAnnouncement({ active: 1, total: 3, more: true }),
		"Match 2 of 3, earlier messages not yet searched.",
	);
	assertEquals(findAnnouncement({ active: -1, total: 0, more: false }), "No matches.");
	assertEquals(
		findAnnouncement({ active: -1, total: 0, more: true }),
		"No matches in the loaded messages. Press Enter to search earlier ones.",
	);
});
