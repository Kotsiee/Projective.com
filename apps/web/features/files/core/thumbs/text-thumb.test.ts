import { assertEquals } from "@std/assert";
import { snippetLines } from "./text-thumb.ts";

Deno.test("a whole short file keeps its last line", () => {
	assertEquals(snippetLines("one\ntwo", true), ["one", "two"]);
});

Deno.test("a read cut short drops the line it may have split", () => {
	assertEquals(snippetLines("one\ntwo\nthr", false), ["one", "two"]);
});

Deno.test("a read of one long line still shows it", () => {
	assertEquals(snippetLines("only line, no newline yet", false), ["only line, no newline yet"]);
});

Deno.test("trailing blank lines are not a preview", () => {
	assertEquals(snippetLines("one\n\n\n", true), ["one"]);
	assertEquals(snippetLines("\n\n", true), []);
});

Deno.test("a card shows ten lines at most, each clipped to what it can hold", () => {
	const lines = snippetLines(`${"x".repeat(200)}\n`.repeat(30), true);
	assertEquals(lines.length, 10);
	assertEquals(lines[0].length, 80);
});
