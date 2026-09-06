/**
 * The canonical plain-text projection of a rich body.
 *
 * Every rich-text surface on the platform stores its body twice: the formatted document the editor
 * produced, and a flattened twin (`description_text`, `descriptionText`) that search indexes and
 * that a card renders when no formatted body exists. This module is the ONE implementation of that
 * flattening. It had been five — `flattenRichText`, two copies of `stripHtml`, `hasProse` and
 * `hasContent` — and four of them shared the same defect described below, because each was written
 * against the case its own author happened to be looking at.
 *
 * It lives here rather than beside the editor because `@projective/ui` imports only preact, signals
 * and the Material colour utilities (`packages/ui/CLAUDE.md`), so a helper mounted there could not
 * be reached by `@projective/backend`, which is where the value is actually written to a column.
 * The types package already hosts pure derivations for exactly this reason — the money-unit
 * converters are the precedent. Nothing here imports anything, not even zod, so it cannot appear in
 * an import cycle.
 *
 * @module
 */

// #region Element vocabulary
/**
 * The elements that end a line of reader-visible text.
 *
 * Everything absent from this set is INLINE and contributes no whitespace of its own — which is the
 * whole point of the module. The naive `replace(/<[^>]*>/g, " ")` treats a formatting change as a
 * word boundary, so `Lemo<em>nsL</em><strong>emo</strong>ns` — contiguous characters a reader sees
 * as one word — flattened to `Lemo nsL emo ns`. Search then failed to match the word actually on
 * screen, and a card rendered a sentence broken at every bold run.
 *
 * `<pre>` is listed as a block but its INTERNAL line breaks are not preserved: source whitespace is
 * normalised before block boundaries are marked, which is correct for HTML generally and wrong for
 * pre-formatted text specifically. The editor's format allow-list has no code block, so nothing this
 * platform authors can reach that case; stored legacy markup could, and would lose its indentation.
 */
const BLOCK_ELEMENTS: ReadonlySet<string> = new Set([
	"address",
	"article",
	"aside",
	"blockquote",
	"dd",
	"details",
	"div",
	"dl",
	"dt",
	"fieldset",
	"figcaption",
	"figure",
	"footer",
	"form",
	"h1",
	"h2",
	"h3",
	"h4",
	"h5",
	"h6",
	"header",
	"hr",
	"li",
	"main",
	"nav",
	"ol",
	"p",
	"pre",
	"section",
	"summary",
	"table",
	"tbody",
	"td",
	"tfoot",
	"th",
	"thead",
	"tr",
	"ul",
]);

/** Named entities Quill and a paste can realistically produce. Numeric forms are handled generically. */
const NAMED_ENTITIES: Readonly<Record<string, string>> = {
	amp: "&",
	apos: "'",
	gt: ">",
	lt: "<",
	nbsp: " ",
	quot: '"',
};
// #endregion

// #region Delta
/**
 * One operation of a Quill Delta, structurally typed.
 *
 * Declared rather than imported because `quill` is a browser module that touches `document` at
 * import time, and this file is evaluated by the backend. A Delta that reaches here is data read
 * back out of a `jsonb` column, so it is recognised by shape at the point of use, never by identity.
 */
export interface RichTextDeltaOp {
	/** Text, or an embed descriptor (an image, a video). An embed carries no reader-visible text. */
	insert?: string | Record<string, unknown>;
	attributes?: Record<string, unknown>;
}

/** A Quill Delta document — the `{ ops }` envelope `editor.getContents()` returns. */
export interface RichTextDelta {
	ops?: readonly RichTextDeltaOp[];
}

/** Anything a rich-text field is stored or emitted as. */
export type RichTextInput = string | RichTextDelta | null | undefined;

/** Whether a value is a Delta envelope rather than an HTML string. */
function isDelta(value: unknown): value is RichTextDelta {
	return typeof value === "object" && value !== null && !Array.isArray(value) &&
		Array.isArray((value as RichTextDelta).ops);
}
// #endregion

// #region Extraction
/**
 * Decode the character references a flattened body can carry.
 *
 * Run AFTER tags are removed, never before: decoding `&lt;` first would manufacture a `<` that the
 * tag pass then reads as the start of an element and deletes along with the text after it. One pass
 * over the whole string rather than a chain of `.replace()` calls, so `&amp;lt;` decodes to the
 * literal `&lt;` a reader typed instead of being decoded twice into `<`.
 */
function decodeEntities(text: string): string {
	return text.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (match: string, ref: string) => {
		const lower = ref.toLowerCase();
		if (lower.startsWith("#x")) {
			const code = Number.parseInt(lower.slice(2), 16);
			return Number.isFinite(code) && code > 0 && code <= 0x10ffff
				? String.fromCodePoint(code)
				: match;
		}
		if (lower.startsWith("#")) {
			const code = Number.parseInt(lower.slice(1), 10);
			return Number.isFinite(code) && code > 0 && code <= 0x10ffff
				? String.fromCodePoint(code)
				: match;
		}
		return NAMED_ENTITIES[lower] ?? match;
	});
}

/**
 * Collapse the line structure of an already-tag-free string.
 *
 * Horizontal whitespace runs become a single space and a line that holds nothing after trimming is
 * dropped entirely — an empty paragraph is markup, not prose, so it must not open a gap in a search
 * column or push a card's second sentence out of view. The character class excludes `\n` explicitly
 * because `\s` would eat the very boundaries this pass exists to keep.
 */
function normaliseLines(text: string): string {
	return text
		.split("\n")
		.map((line) => line.replace(/[^\S\n]+/g, " ").trim())
		.filter((line) => line.length > 0)
		.join("\n");
}

/**
 * Flatten HTML to the text a reader would see.
 *
 * Inline elements are removed with NO separator so contiguous characters stay contiguous however
 * many formatting runs they cross; block elements become a line break so distinct paragraphs, list
 * items and headings stay distinct.
 */
function flattenHtml(html: string): string {
	const marked = html
		// An element whose content is code, not prose. Removed with its children.
		.replace(/<(script|style)\b[^>]*>[\s\S]*?<\/\1\s*>/gi, " ")
		.replace(/<!--[\s\S]*?-->/g, " ")
		// Source whitespace is not significant in HTML, so it is normalised BEFORE block boundaries
		// are marked. Doing it after would read a pretty-printer's newline as a paragraph break.
		.replace(/\s+/g, " ")
		.replace(/<br\s*\/?>/gi, "\n")
		.replace(
			/<\/?([a-z][a-z0-9]*)\b[^>]*>/gi,
			(_match: string, tag: string) => BLOCK_ELEMENTS.has(tag.toLowerCase()) ? "\n" : "",
		)
		// Any malformed remnant the well-formed pass could not claim (an unclosed `<`, a stray `>`).
		.replace(/<[^>]*>/g, "");

	return normaliseLines(decodeEntities(marked));
}

/**
 * Flatten a Quill Delta to the text a reader would see.
 *
 * Concatenating the string inserts is already correct for the inline case: a Delta splits on every
 * ATTRIBUTE change, so one visible word spans several ops and joining them with anything but the
 * empty string reintroduces the exact defect this module exists to remove. Block structure is
 * carried by the `\n` characters already inside the inserts, so it survives concatenation untouched.
 * An embed insert is an object and contributes nothing.
 */
function flattenDelta(delta: RichTextDelta): string {
	const text = (delta.ops ?? [])
		.map((op) => (typeof op.insert === "string" ? op.insert : ""))
		.join("");
	return normaliseLines(text);
}

/**
 * The flattened twin of a rich body — the single entry point.
 *
 * Accepts either representation, so a caller never has to know which one a column holds. It is
 * deliberately NOT a sanitiser: nothing renders this string as markup, and treating it as safe
 * because the tags are gone would be a claim this function does not make.
 */
export function flattenRichText(value: RichTextInput): string {
	if (!value) return "";
	if (isDelta(value)) return flattenDelta(value);
	return typeof value === "string" ? flattenHtml(value) : "";
}

/**
 * Whether a rich-text value carries actual prose.
 *
 * An emptied editor does not emit `""` — it emits markup such as `<p><br></p>`, which is non-empty
 * to `trim()` and would tick a publishing gate off for a project whose scope nobody has written.
 */
export function hasRichTextProse(value: RichTextInput): boolean {
	return flattenRichText(value).length > 0;
}
// #endregion
