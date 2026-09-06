import { assertEquals, assertStringIncludes } from "@std/assert";
import {
	htmlCarriesFormatting,
	looksLikeMarkdown,
	markdownToHtml,
	shouldParseMarkdown,
} from "./markdown.ts";

/**
 * Tests for the Markdown paste converter.
 *
 * Two things are being protected, and only one of them is the conversion.
 *
 * The first is the DETECTION, because its failure mode is silent and asymmetric. A false negative
 * costs a paste that stays plain, which the reader can see and can fix. A false positive silently
 * restructures text somebody did not write in Markdown — an asterisk in a sentence becoming emphasis,
 * a year at the start of a line becoming a numbered list — and nothing on screen says why. So the
 * cases below are weighted toward prose that must be left alone rather than Markdown that must be
 * caught.
 *
 * The second is the ESCAPING. Clipboard text is untrusted, and every tag this module emits is built
 * after the input has been escaped. Quill's format allow-list would strip a stray element on the way
 * in, but a converter that relies on its consumer to be the only line of defence is one refactor away
 * from being the hole. The escape is therefore asserted here, at the boundary that owns it.
 */

// #region Detection
Deno.test("looksLikeMarkdown catches each supported construct", () => {
	assertEquals(looksLikeMarkdown("# Heading"), true);
	assertEquals(looksLikeMarkdown("### Deeper"), true);
	assertEquals(looksLikeMarkdown("some **bold** text"), true);
	assertEquals(looksLikeMarkdown("some __bold__ text"), true);
	assertEquals(looksLikeMarkdown("some *italic* text"), true);
	assertEquals(looksLikeMarkdown("some _italic_ text"), true);
	assertEquals(looksLikeMarkdown("some ~~struck~~ text"), true);
	assertEquals(looksLikeMarkdown("- first\n- second"), true);
	assertEquals(looksLikeMarkdown("* first"), true);
	assertEquals(looksLikeMarkdown("1. first"), true);
	assertEquals(looksLikeMarkdown("an <u>underlined</u> run"), true);
});

Deno.test("looksLikeMarkdown leaves ordinary prose alone", () => {
	assertEquals(looksLikeMarkdown(""), false);
	assertEquals(looksLikeMarkdown("Just a plain sentence."), false);
	// Spaced operators: every marker needs a non-space immediately after it.
	assertEquals(looksLikeMarkdown("2 * 3 * 4 = 24"), false);
	// An identifier, not emphasis — the character before the underscore is a word character.
	assertEquals(looksLikeMarkdown("call snake_case_name here"), false);
	// A dash with nothing after it is a dangling hyphen, not a bullet.
	assertEquals(looksLikeMarkdown("ends with a dash -"), false);
	// A hash with no space is a tag or an anchor.
	assertEquals(looksLikeMarkdown("see #123 for detail"), false);
});

Deno.test("htmlCarriesFormatting tells a rich source from a syntax-highlighted one", () => {
	// What a code editor puts on the clipboard: colour spans, no semantics. The plain twin is the
	// Markdown source, and parsing it is the whole point of the feature.
	assertEquals(
		htmlCarriesFormatting('<div><span style="color:#000"># Heading</span></div>'),
		false,
	);
	// What a rendered document puts there. Quill's own converter understands this better than we do.
	assertEquals(htmlCarriesFormatting("<h1>Heading</h1><p><strong>bold</strong></p>"), true);
	assertEquals(htmlCarriesFormatting("<ul><li>one</li></ul>"), true);
	assertEquals(htmlCarriesFormatting(null), false);
	assertEquals(htmlCarriesFormatting(""), false);
});

Deno.test("shouldParseMarkdown defers to the editor whenever the clipboard is already rich", () => {
	assertEquals(shouldParseMarkdown("# Heading", null), true);
	assertEquals(shouldParseMarkdown("# Heading", "<div><span># Heading</span></div>"), true);
	assertEquals(shouldParseMarkdown("# Heading", "<h1>Heading</h1>"), false);
	assertEquals(shouldParseMarkdown("plain text", null), false);
	assertEquals(shouldParseMarkdown("", null), false);
	assertEquals(shouldParseMarkdown(undefined, undefined), false);
});
// #endregion

// #region Blocks
Deno.test("markdownToHtml converts headings and clamps past the allow-list", () => {
	assertEquals(markdownToHtml("# One"), "<h1>One</h1>");
	assertEquals(markdownToHtml("## Two"), "<h2>Two</h2>");
	assertEquals(markdownToHtml("### Three"), "<h3>Three</h3>");
	// The format set stops at h3. A deeper heading clamps rather than vanishing — it is still a
	// heading, and dropping it would lose the words with it.
	assertEquals(markdownToHtml("##### Five"), "<h3>Five</h3>");
	// A closing run of hashes is ATX decoration, not text.
	assertEquals(markdownToHtml("## Two ##"), "<h2>Two</h2>");
});

Deno.test("markdownToHtml builds both list kinds", () => {
	assertEquals(markdownToHtml("- one\n- two"), "<ul><li>one</li><li>two</li></ul>");
	assertEquals(markdownToHtml("* one\n+ two"), "<ul><li>one</li><li>two</li></ul>");
	assertEquals(markdownToHtml("1. one\n2. two"), "<ol><li>one</li><li>two</li></ol>");
	// Switching marker kind starts a new list rather than mixing two semantics in one element.
	assertEquals(
		markdownToHtml("- bullet\n1. ordered"),
		"<ul><li>bullet</li></ul><ol><li>ordered</li></ol>",
	);
});

Deno.test("an ordered item may only OPEN a list when it is numbered 1", () => {
	// The commonest false positive in the whole module, and the one a reader notices first.
	assertEquals(markdownToHtml("2024. The year we shipped."), "<p>2024. The year we shipped.</p>");
	// Inside a list that a `1.` already opened, later numbers are items as normal.
	assertEquals(
		markdownToHtml("1. first\n2024. second"),
		"<ol><li>first</li><li>second</li></ol>",
	);
});

Deno.test("markdownToHtml joins a wrapped paragraph and splits on a blank line", () => {
	assertEquals(
		markdownToHtml("one line\nwrapped here\n\nsecond paragraph"),
		"<p>one line wrapped here</p><p>second paragraph</p>",
	);
});

Deno.test("a hard break ends the paragraph", () => {
	assertEquals(markdownToHtml("first  \nsecond"), "<p>first</p><p>second</p>");
	assertEquals(markdownToHtml("first\\\nsecond"), "<p>first</p><p>second</p>");
});

Deno.test("a thematic break is dropped, because it is punctuation and not words", () => {
	assertEquals(markdownToHtml("above\n\n---\n\nbelow"), "<p>above</p><p>below</p>");
	assertEquals(markdownToHtml("***"), "");
	// Still distinguishable from a bullet, which needs a space and something after it.
	assertEquals(markdownToHtml("- item"), "<ul><li>item</li></ul>");
});
// #endregion

// #region Unsupported constructs degrade rather than crash
Deno.test("a fenced code block keeps its lines and parses no inline marks inside them", () => {
	const out = markdownToHtml("```ts\nconst a_b = c_d;\n```");
	assertEquals(out, "<p>const a_b = c_d;</p>");
	// Nothing in the code became emphasis, which is what an inline pass over it would have done.
	assertEquals(out.includes("<em>"), false);
});

Deno.test("a table keeps its data rows and loses only its rule", () => {
	const out = markdownToHtml("| a | b |\n|---|---|\n| 1 | 2 |");
	assertStringIncludes(out, "| a | b |");
	assertStringIncludes(out, "| 1 | 2 |");
	assertEquals(out.includes("---"), false);
});

Deno.test("a blockquote keeps its words and loses its marker", () => {
	assertEquals(markdownToHtml("> quoted line"), "<p>quoted line</p>");
});

Deno.test("a link survives literally — lossless beats a rewrite that has to drop half of it", () => {
	assertEquals(
		markdownToHtml("see [the docs](https://example.com) for more"),
		"<p>see [the docs](https://example.com) for more</p>",
	);
});

Deno.test("markdownToHtml returns an empty string when there is nothing to insert", () => {
	assertEquals(markdownToHtml(""), "");
	assertEquals(markdownToHtml("\n\n   \n"), "");
});
// #endregion

// #region Inline marks
Deno.test("bold is consumed before italic, so a double marker is never split", () => {
	assertEquals(markdownToHtml("**bold**"), "<p><strong>bold</strong></p>");
	assertEquals(markdownToHtml("__bold__"), "<p><strong>bold</strong></p>");
	assertEquals(markdownToHtml("***both***"), "<p><strong><em>both</em></strong></p>");
});

Deno.test("italic, strike and underline each convert", () => {
	assertEquals(markdownToHtml("*italic*"), "<p><em>italic</em></p>");
	assertEquals(markdownToHtml("_italic_"), "<p><em>italic</em></p>");
	assertEquals(markdownToHtml("~~struck~~"), "<p><s>struck</s></p>");
	assertEquals(markdownToHtml("an <u>underlined</u> run"), "<p>an <u>underlined</u> run</p>");
});

Deno.test("inline marks apply inside a heading and inside a list item", () => {
	assertEquals(markdownToHtml("# A **bold** title"), "<h1>A <strong>bold</strong> title</h1>");
	assertEquals(
		markdownToHtml("- an *emphatic* item"),
		"<ul><li>an <em>emphatic</em> item</li></ul>",
	);
});

Deno.test("an identifier is not emphasis", () => {
	assertEquals(markdownToHtml("call snake_case_name here"), "<p>call snake_case_name here</p>");
	assertEquals(markdownToHtml("2 * 3 * 4 = 24"), "<p>2 * 3 * 4 = 24</p>");
});

Deno.test("inline code keeps its words and loses its ticks", () => {
	assertEquals(markdownToHtml("run `deno task test` first"), "<p>run deno task test first</p>");
});
// #endregion

// #region Escaping
Deno.test("clipboard text is escaped before any tag is built", () => {
	const out = markdownToHtml("# <script>alert(1)</script>");
	assertEquals(out, "<h1>&lt;script&gt;alert(1)&lt;/script&gt;</h1>");
	// The four characters are visible text, not an element — the point of escaping first.
	assertEquals(out.includes("<script"), false);
});

Deno.test("the ampersand is escaped once, and not double-escaped by a later pass", () => {
	assertEquals(markdownToHtml("Tom & Jerry"), "<p>Tom &amp; Jerry</p>");
	assertEquals(markdownToHtml("&amp;"), "<p>&amp;amp;</p>");
});

Deno.test("only <u> is restored, and no other tag rides in behind it", () => {
	const out = markdownToHtml("<u>keep</u> but <b>not this</b>");
	assertStringIncludes(out, "<u>keep</u>");
	assertEquals(out.includes("<b>"), false);
	assertStringIncludes(out, "&lt;b&gt;");
});
// #endregion
