/**
 * code-lines — the pure text work behind the inspector's code, text and markdown canvases: turning
 * one block of (highlighted) HTML into self-contained lines, finding a query, marking the matches
 * inside highlighted markup, and the measures shown in Details. No DOM, no library: safe in tests
 * and during SSR.
 */

// #region Text
/** `\r\n` and lone `\r` become `\n`, so every later offset counts one character per line break. */
export function normalizeNewlines(text: string): string {
	return text.replace(/\r\n?/g, "\n");
}

/** The text's lines, without the empty line a trailing newline would add. */
export function splitLines(text: string): string[] {
	const lines = text.split("\n");
	if (lines.length > 1 && lines[lines.length - 1] === "") lines.pop();
	return lines;
}

const HTML_ESCAPES: Readonly<Record<string, string>> = {
	"&": "&amp;",
	"<": "&lt;",
	">": "&gt;",
	'"': "&quot;",
	"'": "&#x27;",
};

/** Escape text for an HTML text node or a quoted attribute value. */
export function escapeHtml(text: string): string {
	return text.replace(/[&<>"']/g, (ch) => HTML_ESCAPES[ch] ?? ch);
}

/** Whether the opening slice of a file reads as binary (a NUL byte), so it is not shown as text. */
export function looksBinary(text: string, sample = 8000): boolean {
	return text.slice(0, sample).includes("\u0000");
}
// #endregion

// #region Highlighted lines
const TAG_OR_NEWLINE = /<(\/?)([a-zA-Z][\w-]*)[^>]*>|\n/g;

/**
 * Split highlighted HTML into one well-formed fragment per source line. A span that crosses a line
 * break is closed at the end of the line and reopened at the start of the next, so each line can be
 * rendered on its own and still carry its token colours.
 */
export function splitHighlightedLines(html: string): string[] {
	const lines: string[] = [];
	const open: string[] = [];
	const names: string[] = [];
	let current = "";
	let last = 0;
	for (const match of html.matchAll(TAG_OR_NEWLINE)) {
		const index = match.index ?? 0;
		current += html.slice(last, index);
		last = index + match[0].length;
		if (match[0] === "\n") {
			for (let i = names.length - 1; i >= 0; i--) current += `</${names[i]}>`;
			lines.push(current);
			current = open.join("");
		} else if (match[1] === "/") {
			open.pop();
			names.pop();
			current += match[0];
		} else {
			current += match[0];
			if (!match[0].endsWith("/>")) {
				open.push(match[0]);
				names.push(match[2]);
			}
		}
	}
	current += html.slice(last);
	for (let i = names.length - 1; i >= 0; i--) current += `</${names[i]}>`;
	lines.push(current);
	return lines;
}

/** {@link splitHighlightedLines}, trimmed to the same line count {@link splitLines} gives the text. */
export function highlightedLines(html: string, lineCount: number): string[] {
	const lines = splitHighlightedLines(html);
	return lines.length > lineCount ? lines.slice(0, lineCount) : lines;
}
// #endregion

// #region Find
/** One occurrence of the query: its 0-based line and the character range within that line. */
export interface FindMatch {
	line: number;
	start: number;
	end: number;
}

/** Where the find stopped counting; past it the readout says "N+". */
export const FIND_LIMIT = 5000;

function escapeRegExp(text: string): string {
	return text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/** Every case-insensitive, literal occurrence of `query`, in reading order, up to `limit`. */
export function findMatches(
	lines: readonly string[],
	query: string,
	limit = FIND_LIMIT,
): FindMatch[] {
	if (query.length === 0) return [];
	const pattern = new RegExp(escapeRegExp(query), "giu");
	const matches: FindMatch[] = [];
	for (let line = 0; line < lines.length; line++) {
		pattern.lastIndex = 0;
		for (const m of lines[line].matchAll(pattern)) {
			const start = m.index ?? 0;
			matches.push({ line, start, end: start + m[0].length });
			if (matches.length >= limit) return matches;
		}
	}
	return matches;
}

/** A range to mark inside one line, in source characters; `current` is the active match. */
export interface MarkRange {
	start: number;
	end: number;
	current: boolean;
}

function markOpen(current: boolean): string {
	return current
		? '<mark class="ins-code__match ins-code__match--current">'
		: '<mark class="ins-code__match">';
}

/**
 * Wrap the given source-character ranges of one line's HTML in `<mark>`. Offsets count characters
 * of the source text (an entity such as `&amp;` is one), and a mark never straddles a tag: it is
 * closed before each tag and reopened after it, so the markup stays well formed. Ranges must be
 * sorted and must not overlap.
 */
export function markRanges(html: string, ranges: readonly MarkRange[]): string {
	if (ranges.length === 0) return html;
	let out = "";
	let offset = 0;
	let r = 0;
	let openRange = -1;
	let p = 0;
	while (p < html.length) {
		const ch = html[p];
		if (ch === "<") {
			const close = html.indexOf(">", p);
			const end = close === -1 ? html.length : close + 1;
			if (openRange !== -1) {
				out += "</mark>";
				openRange = -1;
			}
			out += html.slice(p, end);
			p = end;
			continue;
		}
		let unitEnd = p + 1;
		if (ch === "&") {
			const semi = html.indexOf(";", p);
			if (semi !== -1 && semi - p <= 10) unitEnd = semi + 1;
		}
		while (r < ranges.length && ranges[r].end <= offset) r++;
		const inside = r < ranges.length && ranges[r].start <= offset && offset < ranges[r].end;
		if (inside && openRange !== r) {
			if (openRange !== -1) out += "</mark>";
			out += markOpen(ranges[r].current);
			openRange = r;
		} else if (!inside && openRange !== -1) {
			out += "</mark>";
			openRange = -1;
		}
		out += html.slice(p, unitEnd);
		p = unitEnd;
		offset++;
	}
	if (openRange !== -1) out += "</mark>";
	return out;
}
// #endregion

// #region Lines & anchors
/** Prefix of every markdown heading id, so a heading can never clash with a page id. */
export const HEADING_ID_PREFIX = "md-";

/** The 1-based line a `#L12` fragment names, or `null`. */
export function lineFromHash(hash: string): number | null {
	const match = /^#?L(\d{1,9})$/i.exec(hash.trim());
	if (!match) return null;
	const line = Number(match[1]);
	return line >= 1 ? line : null;
}

/** A requested line clamped into `1..lineCount`; `null` when the request is not a number. */
export function clampLine(requested: number, lineCount: number): number | null {
	if (!Number.isFinite(requested) || lineCount < 1) return null;
	return Math.min(Math.max(Math.trunc(requested), 1), lineCount);
}

/**
 * A heading's anchor slug (GitHub style: lower case, punctuation dropped, spaces to hyphens), made
 * unique against the slugs already `taken` by appending `-1`, `-2`…
 */
export function uniqueSlug(text: string, taken: Map<string, number>): string {
	const base = text
		.trim()
		.toLowerCase()
		.replace(/[^\p{L}\p{N}\s_-]/gu, "")
		.replace(/\s+/g, "-") || "section";
	const seen = taken.get(base);
	if (seen === undefined) {
		taken.set(base, 0);
		return base;
	}
	let next = seen + 1;
	while (taken.has(`${base}-${next}`)) next++;
	taken.set(base, next);
	taken.set(`${base}-${next}`, 0);
	return `${base}-${next}`;
}
// #endregion

// #region Measures
/** The counts shown in Details for a text file. */
export interface TextStats {
	lines: number;
	characters: number;
	words: number;
}

/** Lines, characters (code points, not UTF-16 units) and whitespace-separated words. */
export function textStats(text: string): TextStats {
	let characters = 0;
	let words = 0;
	let inWord = false;
	for (let i = 0; i < text.length; i++) {
		const code = text.charCodeAt(i);
		if (code < 0xdc00 || code > 0xdfff) characters++;
		const space = code === 32 || (code >= 9 && code <= 13) || code === 0xa0;
		if (space) inWord = false;
		else if (!inWord) {
			inWord = true;
			words++;
		}
	}
	return { lines: text.length === 0 ? 0 : splitLines(text).length, characters, words };
}

/** Whole minutes to read `words` at an unhurried 230 words a minute; at least one for any text. */
export function readingMinutes(words: number): number {
	return words <= 0 ? 0 : Math.max(1, Math.round(words / 230));
}
// #endregion
