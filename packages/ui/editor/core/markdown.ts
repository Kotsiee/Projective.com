/**
 * Markdown → the editor's own HTML subset.
 *
 * Pasting raw Markdown into a rich-text box is the one paste that arrives as `text/plain` and is
 * nonetheless structured: the reader can see the headings and lists in what they copied, and getting
 * back a wall of `# ` and `- ` reads as the editor having failed. This module is the conversion, and
 * it is deliberately pure — no DOM, no Quill, no signals — because a paste's live behaviour cannot be
 * observed by a static assertion, so everything that can be decided from the text alone is decided
 * here and pinned by `markdown.test.ts`, leaving the island holding only the event plumbing.
 *
 * ## The output vocabulary is the editor's allow-list, and nothing else
 *
 * `RichTextEditor` hands Quill a strict `formats` allow-list — bold · italic · underline · strike ·
 * header · list — so anything else this module emitted would be stripped on the way in anyway. That
 * makes Quill a second line of defence rather than the first: everything here escapes its input
 * BEFORE it builds tags, so a clipboard carrying `<script>` produces the four visible characters and
 * not an element. The one exception is `<u>`, which the brief asks be honoured and which is restored
 * from its escaped form by name — a single literal substitution, never a general un-escape.
 *
 * ## Unsupported constructs degrade to their words, never to nothing
 *
 * Code fences, tables, blockquotes, links and images have no representation in six formats. Each one
 * therefore keeps its text and loses only its decoration: a fence becomes one paragraph per line with
 * no inline parsing (so the code is not silently italicised by its own underscores), a blockquote
 * loses its `>`, a table loses only its `|---|` rule, and a link keeps its literal `[text](url)`
 * because that is lossless and any rewrite would have to choose between dropping the label and
 * dropping the address. The single construct that is DROPPED is a thematic break: `---` is not text,
 * it is punctuation standing in for a rule this format set cannot draw, and leaving it behind puts
 * three literal dashes in the middle of somebody's description.
 *
 * @module
 */

// #region Detection
/**
 * The constructs whose presence means "this plain text is Markdown".
 *
 * Every one requires a non-space character after its marker, which is what keeps ordinary prose out:
 * `2 * 3 * 4` has a space after each star, a bulleted-looking `- ` at the end of a line has nothing
 * after it, and `snake_case` has a word character before its underscore. The cost of a false positive
 * here is a paste that silently restructures text the reader did not write in Markdown, so the
 * patterns are tight rather than generous.
 */
const MARKDOWN_SIGNALS: readonly RegExp[] = [
	/^ {0,3}#{1,6}[ \t]+\S/m, // # Heading
	/\*\*(?=\S)[\s\S]*?\S\*\*/, // **bold**
	/__(?=\S)[^_]*?\S__/, // __bold__
	/~~(?=\S)[^~]*?\S~~/, // ~~strike~~
	/(?:^|[^\w*])\*(?=\S)[^*\n]*?\S\*(?!\w)/, // *italic*
	/(?:^|[^\w_])_(?=\S)[^_\n]*?\S_(?!\w)/, // _italic_
	/^ {0,3}[-*+][ \t]+\S/m, // - bullet
	/^ {0,3}\d{1,9}[.)][ \t]+\S/m, // 1. ordered
	/<u>[\s\S]*?<\/u>/i, // <u>underline</u>
];

/** Whether a plain-text clipboard payload carries any Markdown this module can act on. */
export function looksLikeMarkdown(text: string): boolean {
	if (!text) return false;
	return MARKDOWN_SIGNALS.some((pattern) => pattern.test(text));
}

/**
 * The tags that mean an HTML clipboard payload already carries formatting worth keeping.
 *
 * Deliberately the editor's own vocabulary plus its near neighbours: if the source put any of these
 * on the clipboard, it was a rich document and Quill's own converter — which understands nesting,
 * attributes and Word's markup — will do a better job than re-reading the plain-text twin.
 */
const HTML_FORMATTING =
	/<\s*(?:h[1-6]|strong|b|em|i|u|s|del|strike|ins|ul|ol|li|blockquote)[\s/>]/i;

/**
 * Whether an HTML clipboard payload carries semantic formatting, as opposed to being a plain wrapper.
 *
 * A code editor puts syntax-highlighted HTML on the clipboard — `<div>`s and `<span style=…>`s with
 * no semantic marks at all — which is exactly the case where the plain-text twin IS the Markdown
 * source and should be parsed. A rendered README puts real `<h1>`/`<strong>` on it, which is the case
 * where it should not.
 */
export function htmlCarriesFormatting(html: string | null | undefined): boolean {
	return !!html && HTML_FORMATTING.test(html);
}

/**
 * The whole interception decision, in one pure call: parse this paste as Markdown, or let the editor
 * handle it natively?
 */
export function shouldParseMarkdown(
	text: string | null | undefined,
	html?: string | null,
): boolean {
	if (!text) return false;
	if (htmlCarriesFormatting(html)) return false;
	return looksLikeMarkdown(text);
}
// #endregion

// #region Inline marks
/** Escape the three characters that could otherwise open an element. Runs before any tag is built. */
function escapeHtml(text: string): string {
	return text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

/**
 * Convert the inline marks inside one block's text.
 *
 * ORDER IS LOAD-BEARING. `**bold**` has to be consumed whole before the single-star italic rule runs,
 * or that rule matches the first two stars as an empty emphasis and splits the word. The same holds
 * for `__`/`_`. Everything runs against ALREADY-ESCAPED text, so a match can only ever wrap
 * characters, never re-interpret markup the clipboard supplied.
 */
function inlineMarks(raw: string): string {
	let out = escapeHtml(raw);
	// The one HTML tag the format set accepts from a paste, restored by name from its escaped form.
	out = out.replace(/&lt;u&gt;/gi, "<u>").replace(/&lt;\/u&gt;/gi, "</u>");
	// Inline code has no format here: keep the words, drop the ticks.
	out = out.replace(/`([^`\n]+)`/g, "$1");
	// The triple form is matched WHOLE and first. Left to the bold rule, its lazy group runs from the
	// first two markers to the middle of the closing three, and the emphasis it leaves behind then
	// closes outside the strong it opened inside — malformed nesting that a DOM parser silently
	// repairs into the wrong formatting rather than into an error anyone would see.
	out = out.replace(/\*\*\*(?=\S)([^*]*?\S)\*\*\*/g, "<strong><em>$1</em></strong>");
	out = out.replace(/___(?=\S)([^_]*?\S)___/g, "<strong><em>$1</em></strong>");
	out = out.replace(/\*\*(?=\S)([\s\S]*?\S)\*\*/g, "<strong>$1</strong>");
	out = out.replace(/__(?=\S)([^_]*?\S)__/g, "<strong>$1</strong>");
	out = out.replace(/~~(?=\S)([^~]*?\S)~~/g, "<s>$1</s>");
	out = out.replace(/(^|[^\w*])\*(?=\S)([^*\n]*?\S)\*(?!\w)/g, "$1<em>$2</em>");
	out = out.replace(/(^|[^\w_])_(?=\S)([^_\n]*?\S)_(?!\w)/g, "$1<em>$2</em>");
	return out;
}
// #endregion

// #region Block grammar
const HEADING = /^ {0,3}(#{1,6})[ \t]+(.*)$/;
const BULLET_ITEM = /^ {0,3}[-*+][ \t]+(.*)$/;
const ORDERED_ITEM = /^ {0,3}(\d{1,9})[.)][ \t]+(.*)$/;
const CODE_FENCE = /^ {0,3}(?:`{3,}|~{3,})/;
const BLOCK_QUOTE = /^ {0,3}> ?(.*)$/;
const THEMATIC_BREAK = /^ {0,3}([-*_])[ \t]*(?:\1[ \t]*){2,}$/;
const TABLE_RULE = /^ {0,3}\|?[ \t]*:?-+:?[ \t]*(?:\|[ \t]*:?-+:?[ \t]*)+\|?[ \t]*$/;
/** A trailing double space or backslash is Markdown's hard line break. */
const HARD_BREAK = /(?: {2,}|\\)$/;

/** Headings deeper than the allow-list clamp rather than vanish — an `<h4>` is still a heading. */
const MAX_HEADING = 3;

interface ListState {
	ordered: boolean;
	items: string[];
}

/**
 * Convert Markdown source into the editor's HTML subset. Returns `""` when there is nothing to
 * insert, which is the island's signal to leave the paste alone.
 */
export function markdownToHtml(source: string): string {
	if (!source) return "";
	const lines = source.replace(/\r\n?/g, "\n").split("\n");
	const out: string[] = [];

	let paragraph: string[] = [];
	let list: ListState | null = null;
	let inCodeFence = false;

	const flushParagraph = () => {
		if (paragraph.length === 0) return;
		out.push(`<p>${inlineMarks(paragraph.join(" "))}</p>`);
		paragraph = [];
	};
	const flushList = () => {
		if (!list) return;
		const tag = list.ordered ? "ol" : "ul";
		const items = list.items.map((item) => `<li>${inlineMarks(item)}</li>`).join("");
		out.push(`<${tag}>${items}</${tag}>`);
		list = null;
	};
	const flushAll = () => {
		flushParagraph();
		flushList();
	};

	for (const line of lines) {
		if (CODE_FENCE.test(line)) {
			flushAll();
			inCodeFence = !inCodeFence;
			continue;
		}
		// Inside a fence every line is literal: no inline parsing, so an underscore in a variable name
		// cannot silently become emphasis, and the indentation survives as text.
		if (inCodeFence) {
			out.push(`<p>${escapeHtml(line)}</p>`);
			continue;
		}

		if (line.trim() === "") {
			flushAll();
			continue;
		}
		// A rule this format set cannot draw, and not a word the reader would miss.
		if (THEMATIC_BREAK.test(line)) {
			flushAll();
			continue;
		}
		// A table keeps every data row as text; only its `|---|` rule is pure punctuation.
		if (TABLE_RULE.test(line)) {
			continue;
		}

		const heading = HEADING.exec(line);
		if (heading) {
			flushAll();
			const level = Math.min(heading[1].length, MAX_HEADING);
			// A closing run of `#`s is decoration in ATX headings, not part of the text.
			const text = heading[2].replace(/[ \t]+#+[ \t]*$/, "").trim();
			if (text) out.push(`<h${level}>${inlineMarks(text)}</h${level}>`);
			continue;
		}

		const bullet = BULLET_ITEM.exec(line);
		if (bullet) {
			flushParagraph();
			if (list && list.ordered) flushList();
			if (!list) list = { ordered: false, items: [] };
			list.items.push(bullet[1].trim());
			continue;
		}

		const ordered = ORDERED_ITEM.exec(line);
		// An ordered item may only OPEN a list when it is numbered 1. Without that rule a sentence
		// beginning "2024. The year we…" becomes a list item, which is the commonest false positive
		// in this whole module and the one a reader would notice first.
		if (ordered && ((list && list.ordered) || ordered[1] === "1")) {
			flushParagraph();
			if (list && !list.ordered) flushList();
			if (!list) list = { ordered: true, items: [] };
			list.items.push(ordered[2].trim());
			continue;
		}

		const quoted = BLOCK_QUOTE.exec(line);
		const text = quoted ? quoted[1] : line;
		if (quoted) flushAll();

		flushList();
		// The marker is punctuation for the parser, not text for the reader: it comes off before the
		// line is kept, or a backslash break renders a literal backslash at the end of its paragraph.
		const hardBreak = HARD_BREAK.test(text);
		const content = text.replace(HARD_BREAK, "").trim();
		if (content) paragraph.push(content);
		// A hard break ends the paragraph rather than emitting a `<br>`: Quill turns a `<br>` into a
		// block boundary anyway, and building the boundary here keeps the output independent of it.
		if (hardBreak) flushParagraph();
	}

	flushAll();
	return out.join("");
}
// #endregion
