import { assertEquals } from "@std/assert";
import { sanitizeRichText } from "./sanitize.ts";

// #region What the editor writes survives untouched
Deno.test("sanitizeRichText — the editor's own output is returned exactly as written", () => {
	const html = "<h2>Agenda</h2><p>Bring&nbsp;the <strong>draft</strong>, <em>notes</em>, " +
		"<u>budget</u> and <s>slides</s>.</p><ol><li>Intro</li><li>Review</li></ol>" +
		"<ul><li>Q&amp;A</li></ul><p><br></p>";
	assertEquals(sanitizeRichText(html), html);
});

Deno.test("sanitizeRichText — idempotent, and plain text is escaped rather than lost", () => {
	const once = sanitizeRichText("a < b && c > d <3 <p>x</p>");
	assertEquals(once, "a &lt; b &amp;&amp; c &gt; d &lt;3 <p>x</p>");
	assertEquals(sanitizeRichText(once), once);
});
// #endregion

// #region Script vectors
Deno.test("sanitizeRichText — a script is removed with its content", () => {
	assertEquals(
		sanitizeRichText("<p>hi</p><script>alert(1)</script><p>bye</p>"),
		"<p>hi</p><p>bye</p>",
	);
	assertEquals(sanitizeRichText("<SCRIPT src=//x.io/a.js></SCRIPT>ok"), "ok");
	// Unclosed: everything after it is code, not prose.
	assertEquals(sanitizeRichText("<p>hi</p><script>alert(1)"), "<p>hi</p>");
	assertEquals(sanitizeRichText("<style>p{}</style><svg><script>x</script></svg>ok"), "ok");
});

Deno.test("sanitizeRichText — every attribute is dropped, so no handler or URL survives", () => {
	assertEquals(sanitizeRichText('<img src=x onerror="alert(1)">'), "");
	assertEquals(sanitizeRichText('<p onclick="alert(1)" style="x">hi</p>'), "<p>hi</p>");
	assertEquals(sanitizeRichText('<a href="javascript:alert(1)">click</a>'), "click");
	assertEquals(sanitizeRichText("<iframe srcdoc='<script>x</script>'></iframe>ok"), "ok");
	assertEquals(sanitizeRichText('<li data-list="checked">x</li>'), "<li>x</li>");
});

Deno.test("sanitizeRichText — quoting and malformed tags cannot smuggle markup through", () => {
	// A `>` inside a quoted value does not end the tag early.
	assertEquals(sanitizeRichText('<img alt=">" src=x onerror=alert(1)>ok'), "ok");
	// An unterminated tag is shown as the text it is, never parsed as an element.
	assertEquals(sanitizeRichText("<img src=x onerror=alert(1)"), "&lt;img src=x onerror=alert(1)");
	assertEquals(sanitizeRichText("<!--><img src=x onerror=alert(1)>-->ok"), "ok");
	assertEquals(sanitizeRichText("<!doctype html><?xml x?>ok"), "ok");
	assertEquals(
		sanitizeRichText("&lt;script&gt;alert(1)&lt;/script&gt;"),
		"&lt;script&gt;alert(1)&lt;/script&gt;",
	);
	assertEquals(sanitizeRichText("<p/onmouseover=alert(1)>x</p >"), "<p>x</p>");
});

Deno.test("sanitizeRichText — an unknown element is unwrapped to its text", () => {
	assertEquals(sanitizeRichText("<div><span class=x>a</span><b>b</b></div>"), "ab");
	assertEquals(sanitizeRichText("<BR/></br>"), "<br>");
});
// #endregion
