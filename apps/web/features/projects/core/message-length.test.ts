import { assertEquals } from "@std/assert";
import {
	CARD_CHARS,
	charCount,
	COLLAPSE_CHARS,
	COLLAPSE_LINES,
	lineCount,
	longMessageSummary,
	messageLengthOf,
} from "./message-length.ts";

Deno.test("a short message reads inline", () => {
	assertEquals(messageLengthOf("Hello there"), "inline");
	assertEquals(messageLengthOf(""), "inline");
	assertEquals(messageLengthOf("a".repeat(COLLAPSE_CHARS)), "inline");
	assertEquals(messageLengthOf(Array(COLLAPSE_LINES).fill("line").join("\n")), "inline");
});

Deno.test("over 750 characters OR over 10 lines collapses, whichever comes first", () => {
	assertEquals(messageLengthOf("a".repeat(COLLAPSE_CHARS + 1)), "collapsible");
	// Eleven short lines — far under the character threshold.
	assertEquals(messageLengthOf(Array(COLLAPSE_LINES + 1).fill("ok").join("\n")), "collapsible");
	assertEquals(messageLengthOf(Array(COLLAPSE_LINES + 1).fill("ok").join("\r\n")), "collapsible");
});

Deno.test("over 4000 characters becomes a card, even when it has few lines", () => {
	assertEquals(messageLengthOf("a".repeat(CARD_CHARS)), "collapsible");
	assertEquals(messageLengthOf("a".repeat(CARD_CHARS + 1)), "card");
});

Deno.test("characters are counted as a reader counts them — an emoji is one", () => {
	assertEquals(charCount("👍👍"), 2);
	assertEquals(messageLengthOf("👍".repeat(COLLAPSE_CHARS)), "inline");
	assertEquals(lineCount(""), 0);
	assertEquals(lineCount("a\nb\r\nc"), 3);
});

Deno.test("a long-message card previews the opening on one line and counts what is there", () => {
	const text = `First line\n\nSecond   paragraph ${"word ".repeat(100)}`;
	const s = longMessageSummary(text);
	assertEquals(s.preview.startsWith("First line Second paragraph word"), true);
	assertEquals(s.preview.endsWith("…"), true);
	assertEquals(Array.from(s.preview).length, 160);
	assertEquals(s.words, 104);
	assertEquals(s.chars, charCount(text));
});
