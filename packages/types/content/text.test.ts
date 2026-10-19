/**
 * Plain-text projections and display dates — what a meta description, an FAQPage answer and a
 * reading-time estimate are built from — and the storable-text rule free-text writes refine with.
 */
import { assert, assertEquals, assertFalse } from "@std/assert";
import {
	docText,
	formatContentDate,
	inlineText,
	isStorableText,
	nodesText,
	readingMinutes,
	wordCount,
} from "./mod.ts";
import { SAMPLE_DOC } from "./fixtures.ts";

Deno.test("isStorableText: tab, newlines and real surrogate pairs pass; NUL, C0 and lone halves do not", () => {
	assert(isStorableText(""));
	assert(isStorableText("Line one\r\nline two\tindented — café 🎉"));
	assertFalse(isStorableText("nul\u0000byte"), "Postgres refuses NUL in text and jsonb (22P05)");
	assertFalse(isStorableText("bell\u0007"));
	assertFalse(isStorableText("escape\u001b[0m"));
	assertFalse(isStorableText("lone high \ud800 surrogate"), "PostgREST refuses it (PGRST102)");
	assertFalse(isStorableText("trailing high \ud83c"));
	assertFalse(isStorableText("lone low \udc00 surrogate"));
	assertFalse(isStorableText("reversed \udf89\ud83c pair"));
	assert(isStorableText("\u007f is DEL, which Postgres stores"));
});

Deno.test("inline runs join without inventing spaces", () => {
	assertEquals(
		inlineText(["Funds are ", { type: "strong", text: "held" }, "."]),
		"Funds are held.",
	);
	assertEquals(inlineText("plain"), "plain");
	assertEquals(inlineText([{ type: "link", href: "/help", text: "help" }, "!"]), "help!");
});

Deno.test("lists flatten one item per line with nesting indented", () => {
	const text = nodesText([{
		type: "list",
		items: ["a", { content: "b", list: { type: "list", items: ["c"] } }],
	}]);
	assertEquals(text, "a\nb\n  c");
});

Deno.test("tables, quotes and callouts project to readable text", () => {
	assertEquals(
		nodesText([
			{ type: "quote", content: "Ship it.", cite: "A client" },
			{ type: "table", head: ["A", "B"], rows: [["1", "2"]] },
			{ type: "callout", tone: "note", body: [{ type: "p", content: "Heads up." }] },
		]),
		"Ship it. — A client\n\nA · B\n1 · 2\n\nHeads up.",
	);
});

Deno.test("definition lists and key runs project to readable text", () => {
	assertEquals(
		nodesText([
			{ type: "p", content: ["Press ", { type: "kbd", text: "Ctrl+/" }, "."] },
			{
				type: "dl",
				items: [
					{ term: "Stage", definition: "One funded unit." },
					{ term: "Release", definition: ["Money ", { type: "em", text: "moves" }] },
				],
			},
		]),
		"Press Ctrl+/.\n\nStage — One funded unit.\nRelease — Money moves",
	);
});

Deno.test("the document text starts with its title and summary and includes every section", () => {
	const text = docText(SAMPLE_DOC);
	assert(text.startsWith(`${SAMPLE_DOC.title}\n\n${SAMPLE_DOC.summary}`));
	for (const s of SAMPLE_DOC.sections) assert(text.includes(s.heading), s.heading);
});

Deno.test("word counts keep contractions whole; reading time is at least a minute", () => {
	assertEquals(wordCount("It's a 5% fee — isn't it?"), 6);
	assertEquals(readingMinutes(SAMPLE_DOC), 1);
	const words = (n: number) => Array.from({ length: n }, () => "word").join(" ");
	const sized = (n: number) => ({
		...SAMPLE_DOC,
		title: "T",
		summary: words(n),
		sections: [{ id: "a", heading: "H", body: [{ type: "p" as const, content: "x" }] }],
	});
	// title + heading + body add three words to the summary's n.
	assertEquals(readingMinutes(sized(457)), 2);
	assertEquals(readingMinutes(sized(1147)), 5);
	assertEquals(readingMinutes(sized(1147), 115), 10);
});

Deno.test("content dates format in UTC, whatever the reader's zone", () => {
	assertEquals(formatContentDate("2026-10-17"), "17 October 2026");
	assertEquals(formatContentDate("2026-01-01", "en-US"), "January 1, 2026");
	assertEquals(formatContentDate("not-a-date"), "not-a-date");
});
