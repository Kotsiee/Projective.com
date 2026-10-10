/**
 * pdf-find — the pure text search behind "Find in document". A page's text is its text items joined
 * in reading order (a line end counts as a space), matched case-insensitively with any run of
 * whitespace standing for one space. A match maps back onto the items it covers, which are the
 * text layer's spans one for one, so the canvas can mark exactly those characters.
 */

// #region Types
/** One text item as pdf.js reports it. */
export interface PdfTextItem {
	str: string;
	hasEOL: boolean;
}

/** A page's searchable text and where each item starts in it. */
export interface PageTextIndex {
	text: string;
	starts: readonly number[];
	lengths: readonly number[];
}

/** One hit: the page (0-based) and the character offsets in that page's text. */
export interface FindMatch {
	page: number;
	start: number;
	end: number;
}

/** The part of one item a match covers: characters `[from, to)` of item `item`. */
export interface ItemSpan {
	item: number;
	from: number;
	to: number;
}
// #endregion

// #region Index
/** Join a page's items into one searchable string, remembering each item's offset. */
export function indexPageText(items: readonly PdfTextItem[]): PageTextIndex {
	let text = "";
	const starts: number[] = [];
	const lengths: number[] = [];
	for (const item of items) {
		starts.push(text.length);
		lengths.push(item.str.length);
		text += item.str;
		if (item.hasEOL) text += " ";
	}
	return { text, starts, lengths };
}

/** The query as it is matched: trimmed, lower-cased, inner whitespace collapsed to one space. */
export function normalizeQuery(query: string): string {
	return query.trim().replace(/\s+/g, " ").toLowerCase();
}

interface Folded {
	text: string;
	map: number[];
}

function fold(text: string): Folded {
	let out = "";
	const map: number[] = [];
	let inSpace = false;
	for (let i = 0; i < text.length; i++) {
		const ch = text[i];
		if (/\s/.test(ch)) {
			if (inSpace) continue;
			inSpace = true;
			out += " ";
			map.push(i);
			continue;
		}
		inSpace = false;
		const lower = ch.toLowerCase();
		out += lower.length === 1 ? lower : ch;
		map.push(i);
	}
	return { text: out, map };
}
// #endregion

// #region Search
/** Every non-overlapping match of `query` in one page, in reading order. */
export function findInPage(index: PageTextIndex, query: string, page: number): FindMatch[] {
	const needle = normalizeQuery(query);
	if (needle.length === 0 || index.text.length === 0) return [];
	const folded = fold(index.text);
	const matches: FindMatch[] = [];
	let from = 0;
	while (from <= folded.text.length - needle.length) {
		const at = folded.text.indexOf(needle, from);
		if (at < 0) break;
		const last = at + needle.length - 1;
		matches.push({ page, start: folded.map[at], end: folded.map[last] + 1 });
		from = at + needle.length;
	}
	return matches;
}

/** The items a match covers and the characters of each. */
export function matchSpans(index: PageTextIndex, start: number, end: number): ItemSpan[] {
	const spans: ItemSpan[] = [];
	for (let item = 0; item < index.starts.length; item++) {
		const itemStart = index.starts[item];
		const itemEnd = itemStart + index.lengths[item];
		if (itemEnd <= start) continue;
		if (itemStart >= end) break;
		const from = Math.max(start, itemStart) - itemStart;
		const to = Math.min(end, itemEnd) - itemStart;
		if (to > from) spans.push({ item, from, to });
	}
	return spans;
}

/** The match to start from: the first on or after `page` (0-based), wrapping to the first overall. */
export function firstMatchFrom(matches: readonly FindMatch[], page: number): number {
	if (matches.length === 0) return -1;
	const at = matches.findIndex((m) => m.page >= page);
	return at >= 0 ? at : 0;
}

/** The next (`1`) or previous (`-1`) match, wrapping around the document. */
export function stepMatch(active: number, total: number, direction: 1 | -1): number {
	if (total <= 0) return -1;
	if (active < 0) return direction === 1 ? 0 : total - 1;
	return (active + direction + total) % total;
}

/** "3 of 12" while a match is selected, the count alone before one is, or "No matches". */
export function matchSummary(active: number, total: number, searching: boolean): string {
	if (total === 0) return searching ? "Searching…" : "No matches";
	const position = active >= 0 ? `${active + 1} of ${total}` : `${total}`;
	return searching ? `${position}…` : position;
}
// #endregion
