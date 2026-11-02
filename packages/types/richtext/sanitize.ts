/**
 * The allow-list sanitiser for rich-text HTML one person writes and another reads.
 *
 * The output is REBUILT, never filtered: every tag is re-emitted from a fixed set with no attributes
 * at all, and everything else is escaped text. So the result is safe by construction whatever the
 * input parses as — a malformed tag, a quote trick or a raw-text element can only ever lose text or
 * show it escaped, never smuggle markup through, because nothing from the input is copied verbatim
 * except characters that are already text.
 *
 * The vocabulary is what `RichTextEditor` emits: its Quill `formats` allow-list (bold · italic ·
 * underline · strike · header · list) serialised by Quill 2's `getSemanticHTML`. No allowed format
 * carries an attribute (`data-list` appears only for checklists, which the editor does not enable),
 * so dropping every attribute loses nothing the editor wrote. Like {@link flattenRichText} it lives
 * in the types package so the backend, which writes the column, and the islands, which render it,
 * share one implementation; it imports nothing.
 *
 * @module
 */

// #region Vocabulary
/** The elements `RichTextEditor` emits. Paste is normalised to these by Quill before it is saved. */
const ALLOWED_TAGS: ReadonlySet<string> = new Set([
	"p",
	"br",
	"h1",
	"h2",
	"h3",
	"h4",
	"h5",
	"h6",
	"strong",
	"em",
	"u",
	"s",
	"ul",
	"ol",
	"li",
]);

/** Elements whose content is not prose: removed with everything inside them, not just unwrapped. */
const DROPPED_WITH_CONTENT: ReadonlySet<string> = new Set([
	"script",
	"style",
	"template",
	"iframe",
	"object",
	"embed",
	"noscript",
	"noembed",
	"noframes",
	"textarea",
	"title",
	"xmp",
	"svg",
	"math",
	"select",
]);

/**
 * One piece of markup: a comment, a `<!…>` / `<?…>` declaration, or a start / end tag whose quoted
 * attribute values may contain `>`. A `<` that starts none of these is text, and is escaped as text.
 */
const MARKUP = /<!--[\s\S]*?-->|<[!?][^>]*>|<(\/?)([a-zA-Z][^\s/>]*)(?:[^>"']|"[^"]*"|'[^']*')*>/g;

/** A well-formed character reference, which is already text and is kept so `&nbsp;` stays a space. */
const BARE_AMPERSAND = /&(?!(?:#\d{1,7}|#x[0-9a-f]{1,6}|[a-z][a-z0-9]{1,31});)/gi;
// #endregion

/** Text as text: no character in it can open a tag or end one. */
function escapeText(text: string): string {
	return text.replace(BARE_AMPERSAND, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

/**
 * Rich-text HTML reduced to the editor's own vocabulary, safe to render with `innerHTML`.
 *
 * Allowed elements are kept with every attribute removed (`<p onclick=…>` → `<p>`); script-like
 * elements are removed with their content; any other element is unwrapped to its text; comments and
 * declarations are removed. Idempotent: sanitising the output again returns it unchanged.
 */
export function sanitizeRichText(html: string): string {
	let out = "";
	let skipping: string | null = null;
	let last = 0;
	for (const m of html.matchAll(MARKUP)) {
		if (!skipping) out += escapeText(html.slice(last, m.index));
		last = m.index + m[0].length;
		const [, close, rawName] = m;
		if (!rawName) continue;
		const name = rawName.toLowerCase();
		if (skipping) {
			if (close && name === skipping) skipping = null;
		} else if (DROPPED_WITH_CONTENT.has(name)) {
			if (!close) skipping = name;
		} else if (ALLOWED_TAGS.has(name)) {
			if (name !== "br") out += `<${close}${name}>`;
			else if (!close) out += "<br>";
		}
	}
	if (!skipping) out += escapeText(html.slice(last));
	return out;
}
