import { assertEquals } from "@std/assert";
import { flattenRichText, hasRichTextProse } from "./plain-text.ts";

// #region Inline formatting must not introduce whitespace
Deno.test("flattenRichText — the reported case: overlapping inline tags stay one word", () => {
	// Typed as one continuous run of `Lemons` x5 with the marks toggled mid-word. The saved HTML is
	// correct; it was the flattening that injected the spaces.
	const html =
		"<p>Lemo<em>nsL</em><strong><em>emo</em>ns<u>Lem</u></strong><u>onsLem</u><s><u>onsLem</u>ons</s></p>";
	assertEquals(flattenRichText(html), "LemonsLemonsLemonsLemonsLemons");
});

Deno.test("flattenRichText — every inline element the editor can emit is transparent", () => {
	assertEquals(flattenRichText("<p>a<strong>b</strong>c</p>"), "abc");
	assertEquals(flattenRichText("<p>a<em>b</em>c</p>"), "abc");
	assertEquals(flattenRichText("<p>a<u>b</u>c</p>"), "abc");
	assertEquals(flattenRichText("<p>a<s>b</s>c</p>"), "abc");
	assertEquals(flattenRichText("<p>a<span class=x>b</span>c</p>"), "abc");
	assertEquals(flattenRichText('<p>a<a href="/x">b</a>c</p>'), "abc");
	// Nested three deep, closing out of the order they opened.
	assertEquals(flattenRichText("<p>a<strong><em><u>b</u></em></strong>c</p>"), "abc");
});

Deno.test("flattenRichText — a real space beside a mark boundary is preserved exactly once", () => {
	assertEquals(flattenRichText("<p>one <strong>two</strong> three</p>"), "one two three");
	// Quill puts the space inside the mark just as readily as outside it.
	assertEquals(flattenRichText("<p>one<strong> two </strong>three</p>"), "one two three");
});
// #endregion

// #region Block boundaries must still separate
Deno.test("flattenRichText — distinct words across block boundaries stay separated", () => {
	assertEquals(flattenRichText("<p>Hello</p><p>World</p>"), "Hello\nWorld");
});

Deno.test("flattenRichText — headings, list items and breaks each end a line", () => {
	assertEquals(flattenRichText("<h1>Title</h1><p>Body</p>"), "Title\nBody");
	assertEquals(
		flattenRichText("<ul><li>Alpha</li><li>Beta</li></ul>"),
		"Alpha\nBeta",
	);
	assertEquals(flattenRichText("<ol><li>One</li><li>Two</li></ol>"), "One\nTwo");
	assertEquals(flattenRichText("<p>Alpha<br>Beta</p>"), "Alpha\nBeta");
	assertEquals(flattenRichText("<p>Alpha<br />Beta</p>"), "Alpha\nBeta");
});

Deno.test("flattenRichText — a block boundary inside a mark still breaks the line", () => {
	// The mark spans two list items; the items must not fuse into one word.
	assertEquals(
		flattenRichText("<ul><li><strong>Alpha</strong></li><li><strong>Beta</strong></li></ul>"),
		"Alpha\nBeta",
	);
});

Deno.test("flattenRichText — an empty paragraph opens no gap", () => {
	assertEquals(flattenRichText("<p>Alpha</p><p><br></p><p>Beta</p>"), "Alpha\nBeta");
});
// #endregion

// #region Whitespace and entities
Deno.test("flattenRichText — source pretty-printing is not a paragraph break", () => {
	// A newline between tags is insignificant HTML whitespace, not a line the reader sees.
	assertEquals(flattenRichText("<p>\n  Hello\n  World\n</p>"), "Hello World");
});

Deno.test("flattenRichText — entities decode, and decode only once", () => {
	assertEquals(flattenRichText("<p>a&nbsp;b</p>"), "a b");
	assertEquals(flattenRichText("<p>Tom &amp; Jerry</p>"), "Tom & Jerry");
	assertEquals(flattenRichText("<p>&lt;p&gt;</p>"), "<p>");
	assertEquals(flattenRichText("<p>&#39;q&quot;</p>"), "'q\"");
	assertEquals(flattenRichText("<p>&#x2014;</p>"), "—");
	// `&amp;lt;` is a literal `&lt;` a reader typed — decoding it twice would print `<`.
	assertEquals(flattenRichText("<p>&amp;lt;</p>"), "&lt;");
	// An entity that decoding cannot claim survives verbatim rather than being deleted.
	assertEquals(flattenRichText("<p>a&notreal;b</p>"), "a&notreal;b");
});

Deno.test("flattenRichText — runs of whitespace collapse to one space", () => {
	assertEquals(flattenRichText("<p>a&nbsp;&nbsp;&nbsp;b</p>"), "a b");
	assertEquals(flattenRichText("<p>a   \t  b</p>"), "a b");
});
// #endregion

// #region Robustness
Deno.test("flattenRichText — empty and absent bodies flatten to the empty string", () => {
	assertEquals(flattenRichText(""), "");
	assertEquals(flattenRichText(null), "");
	assertEquals(flattenRichText(undefined), "");
	// What an emptied Quill document actually serialises to.
	assertEquals(flattenRichText("<p><br></p>"), "");
	assertEquals(flattenRichText("<p></p>"), "");
});

Deno.test("flattenRichText — plain prose with no markup passes through", () => {
	assertEquals(flattenRichText("Just a sentence."), "Just a sentence.");
});

Deno.test("flattenRichText — script and style content is not reader-visible text", () => {
	assertEquals(flattenRichText("<p>a</p><script>var x = 1;</script><p>b</p>"), "a\nb");
	assertEquals(flattenRichText("<style>.x{color:red}</style><p>b</p>"), "b");
});

Deno.test("flattenRichText — malformed markup does not leak a tag", () => {
	assertEquals(flattenRichText("<p>a<strongb</p>"), "a");
	assertEquals(flattenRichText("<p>a</p><p>b"), "a\nb");
});
// #endregion

// #region Delta
Deno.test("flattenRichText — a Delta's per-attribute ops concatenate without separators", () => {
	// The Delta twin of the reported case: Quill splits on every attribute change, so the same word
	// arrives as several ops. Joining them with anything but "" reintroduces the defect.
	const delta = {
		ops: [
			{ insert: "Lemo" },
			{ insert: "nsL", attributes: { italic: true } },
			{ insert: "emo", attributes: { bold: true, italic: true } },
			{ insert: "ns", attributes: { bold: true } },
			{ insert: "Lem", attributes: { bold: true, underline: true } },
			{ insert: "onsLem", attributes: { underline: true } },
			{ insert: "onsLem", attributes: { strike: true, underline: true } },
			{ insert: "ons", attributes: { strike: true } },
			{ insert: "\n" },
		],
	};
	assertEquals(flattenRichText(delta), "LemonsLemonsLemonsLemonsLemons");
});

Deno.test("flattenRichText — a Delta's line breaks still separate blocks", () => {
	assertEquals(
		flattenRichText({ ops: [{ insert: "Hello\nWorld\n" }] }),
		"Hello\nWorld",
	);
	assertEquals(
		flattenRichText({
			ops: [
				{ insert: "Alpha" },
				{ insert: "\n", attributes: { list: "bullet" } },
				{ insert: "Beta" },
				{ insert: "\n", attributes: { list: "bullet" } },
			],
		}),
		"Alpha\nBeta",
	);
});

Deno.test("flattenRichText — an embed insert contributes no text", () => {
	assertEquals(
		flattenRichText({ ops: [{ insert: "a" }, { insert: { image: "x.png" } }, { insert: "b" }] }),
		"ab",
	);
	assertEquals(flattenRichText({ ops: [] }), "");
	assertEquals(flattenRichText({}), "");
});
// #endregion

// #region The emptiness predicate
Deno.test("hasRichTextProse — markup alone is not prose", () => {
	assertEquals(hasRichTextProse("<p><br></p>"), false);
	assertEquals(hasRichTextProse("<p>&nbsp;</p>"), false);
	assertEquals(hasRichTextProse("<ul><li><br></li></ul>"), false);
	assertEquals(hasRichTextProse(""), false);
	assertEquals(hasRichTextProse(null), false);
	assertEquals(hasRichTextProse(undefined), false);
});

Deno.test("hasRichTextProse — any reader-visible character is prose", () => {
	assertEquals(hasRichTextProse("<p>a</p>"), true);
	assertEquals(hasRichTextProse("<p><strong>a</strong></p>"), true);
	assertEquals(hasRichTextProse("plain"), true);
	assertEquals(hasRichTextProse({ ops: [{ insert: "a\n" }] }), true);
	assertEquals(hasRichTextProse({ ops: [{ insert: "\n" }] }), false);
});
// #endregion
