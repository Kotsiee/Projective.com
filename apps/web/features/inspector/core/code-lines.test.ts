import { assertEquals } from "@std/assert";
import {
	clampLine,
	escapeHtml,
	findMatches,
	highlightedLines,
	lineFromHash,
	looksBinary,
	markRanges,
	normalizeNewlines,
	readingMinutes,
	splitHighlightedLines,
	splitLines,
	textStats,
	uniqueSlug,
} from "./code-lines.ts";

Deno.test("normalizeNewlines + splitLines: CRLF, CR and a trailing newline", () => {
	assertEquals(splitLines(normalizeNewlines("a\r\nb\rc\n")), ["a", "b", "c"]);
	assertEquals(splitLines(""), [""]);
	assertEquals(splitLines("\n"), [""]);
	assertEquals(splitLines("a\n\n"), ["a", ""]);
});

Deno.test("escapeHtml escapes markup and quotes", () => {
	assertEquals(
		escapeHtml(`<a href="x">'&'</a>`),
		"&lt;a href=&quot;x&quot;&gt;&#x27;&amp;&#x27;&lt;/a&gt;",
	);
});

Deno.test("looksBinary flags a NUL byte in the sample only", () => {
	assertEquals(looksBinary("plain text"), false);
	assertEquals(looksBinary("PK\u0003\u0004\u0000"), true);
	assertEquals(looksBinary(`${"a".repeat(10)}\u0000`, 5), false);
});

Deno.test("splitHighlightedLines closes and reopens spans across line breaks", () => {
	const html =
		'<span class="hljs-comment">/* one\ntwo */</span>\n<span class="hljs-string">"x"</span>';
	assertEquals(splitHighlightedLines(html), [
		'<span class="hljs-comment">/* one</span>',
		'<span class="hljs-comment">two */</span>',
		'<span class="hljs-string">"x"</span>',
	]);
});

Deno.test("splitHighlightedLines keeps nested spans balanced", () => {
	const html = '<span class="a">x<span class="b">y\nz</span>w</span>';
	assertEquals(splitHighlightedLines(html), [
		'<span class="a">x<span class="b">y</span></span>',
		'<span class="a"><span class="b">z</span>w</span>',
	]);
});

Deno.test("highlightedLines drops the empty line after a trailing newline", () => {
	assertEquals(highlightedLines("a\nb\n", 2), ["a", "b"]);
	assertEquals(highlightedLines("a", 1), ["a"]);
});

Deno.test("findMatches is literal, case-insensitive and capped", () => {
	const lines = ["Foo foo", "a.b", "FOO"];
	assertEquals(findMatches(lines, "foo"), [
		{ line: 0, start: 0, end: 3 },
		{ line: 0, start: 4, end: 7 },
		{ line: 2, start: 0, end: 3 },
	]);
	assertEquals(findMatches(lines, "."), [{ line: 1, start: 1, end: 2 }]);
	assertEquals(findMatches(lines, ""), []);
	assertEquals(findMatches(lines, "foo", 2).length, 2);
});

Deno.test("markRanges counts entities as one character and never straddles a tag", () => {
	assertEquals(
		markRanges("a &amp; b", [{ start: 2, end: 3, current: false }]),
		'a <mark class="ins-code__match">&amp;</mark> b',
	);
	assertEquals(
		markRanges('<span class="k">ab</span>cd', [{ start: 1, end: 3, current: true }]),
		'<span class="k">a<mark class="ins-code__match ins-code__match--current">b</mark></span>' +
			'<mark class="ins-code__match ins-code__match--current">c</mark>d',
	);
	assertEquals(
		markRanges("abcd", [{ start: 0, end: 1, current: false }, { start: 1, end: 2, current: true }]),
		'<mark class="ins-code__match">a</mark>' +
			'<mark class="ins-code__match ins-code__match--current">b</mark>cd',
	);
	assertEquals(markRanges("abc", []), "abc");
});

Deno.test("lineFromHash and clampLine", () => {
	assertEquals(lineFromHash("#L12"), 12);
	assertEquals(lineFromHash("l3"), 3);
	assertEquals(lineFromHash("#L0"), null);
	assertEquals(lineFromHash("#intro"), null);
	assertEquals(clampLine(99, 10), 10);
	assertEquals(clampLine(-4, 10), 1);
	assertEquals(clampLine(3.7, 10), 3);
	assertEquals(clampLine(Number.NaN, 10), null);
	assertEquals(clampLine(1, 0), null);
});

Deno.test("uniqueSlug follows GitHub's anchor rules", () => {
	const taken = new Map<string, number>();
	assertEquals(uniqueSlug("Getting Started!", taken), "getting-started");
	assertEquals(uniqueSlug("Getting started", taken), "getting-started-1");
	assertEquals(uniqueSlug("Getting started", taken), "getting-started-2");
	assertEquals(uniqueSlug("Über straße", taken), "über-straße");
	assertEquals(uniqueSlug("???", taken), "section");
});

Deno.test("textStats counts code points, words and lines", () => {
	assertEquals(textStats("one two\nthree 😀\n"), { lines: 2, characters: 16, words: 4 });
	assertEquals(textStats(""), { lines: 0, characters: 0, words: 0 });
	assertEquals(readingMinutes(0), 0);
	assertEquals(readingMinutes(10), 1);
	assertEquals(readingMinutes(1150), 5);
});
