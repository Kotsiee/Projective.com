/**
 * content.text — plain-text projections and display formatting of a document, and the one
 * storable-text rule every free-text field refines with ({@link isStorableText}).
 *
 * The plain text of a body is what a meta description, an FAQPage answer, a search index and a
 * reading-time estimate read; it is derived here from the AST so no consumer re-walks the nodes.
 *
 * @module
 */
import type { Doc } from "./doc.ts";
import type { ContentNode, InlineContent, InlineRun, ListNode, SimpleBlock } from "./nodes.ts";

// #region Plain text
/** The text of one inline run. */
export function runText(run: InlineRun): string {
	return typeof run === "string" ? run : run.text;
}

/** The plain text of inline content (a string, or runs joined without added spaces). */
export function inlineText(content: InlineContent): string {
	return typeof content === "string" ? content : content.map(runText).join("");
}

/** The plain text of a list, one item per line, nested items indented by their depth. */
function listText(list: ListNode, depth = 0): string {
	return list.items
		.map((item) => {
			const own = typeof item === "string" ? item : inlineText(item.content);
			const nested = typeof item === "string" || !item.list
				? ""
				: `\n${listText(item.list, depth + 1)}`;
			return `${"  ".repeat(depth)}${own}${nested}`;
		})
		.join("\n");
}

/** The plain text of one block node. */
export function nodeText(node: ContentNode | SimpleBlock): string {
	switch (node.type) {
		case "p":
		case "quote":
			return node.type === "quote" && node.cite
				? `${inlineText(node.content)} — ${node.cite}`
				: inlineText(node.content);
		case "h3":
			return node.text;
		case "list":
			return listText(node);
		case "code":
			return node.text;
		case "image":
			return node.caption ?? node.alt;
		case "callout":
			return node.body.map(nodeText).join("\n");
		case "table":
			return [node.head, ...node.rows].map((row) => row.map(inlineText).join(" · ")).join("\n");
		case "dl":
			return node.items.map((item) => `${item.term} — ${inlineText(item.definition)}`).join("\n");
	}
}

/** The plain text of a block sequence, blocks separated by a blank line. */
export function nodesText(nodes: readonly (ContentNode | SimpleBlock)[]): string {
	return nodes.map(nodeText).filter((text) => text.length > 0).join("\n\n");
}

/** The whole document as plain text: title, summary, then each section's heading and body. */
export function docText(doc: Doc): string {
	return [
		doc.title,
		doc.summary,
		...doc.sections.flatMap((section) => [
			section.heading,
			section.tldr ? inlineText(section.tldr) : "",
			nodesText(section.body),
		]),
	].filter((part) => part.length > 0).join("\n\n");
}
// #endregion

// #region Storable text
/** The sentence a field shows when its text holds a character no layer below can store. */
export const UNSTORABLE_TEXT_MESSAGE = "Remove the hidden control character and try again.";

/**
 * Whether `value` can be stored as Postgres `text` / `jsonb` and sent through PostgREST: no NUL or
 * other C0 control character except tab, line feed and carriage return (Postgres refuses `\u0000`
 * with 22P05), and no unpaired UTF-16 surrogate (PostgREST refuses the body with PGRST102). A
 * free-text field of a write refines with it, so such input is a 422 field error at the schema —
 * the same on the client and the server — and never a 503 from the writer.
 */
export function isStorableText(value: string): boolean {
	for (let i = 0; i < value.length; i++) {
		const unit = value.charCodeAt(i);
		if (unit < 0x20) {
			if (unit !== 0x09 && unit !== 0x0a && unit !== 0x0d) return false;
		} else if (unit >= 0xd800 && unit <= 0xdbff) {
			const next = value.charCodeAt(i + 1);
			if (!(next >= 0xdc00 && next <= 0xdfff)) return false;
			i++;
		} else if (unit >= 0xdc00 && unit <= 0xdfff) {
			return false;
		}
	}
	return true;
}
// #endregion

// #region Reading time & dates
/** Words in `text` (runs of letters/digits, apostrophes kept inside a word). */
export function wordCount(text: string): number {
	return text.match(/[\p{L}\p{N}]+(?:['’][\p{L}\p{N}]+)*/gu)?.length ?? 0;
}

/** Whole minutes to read `doc` at `wordsPerMinute` (default 230), never less than 1. */
export function readingMinutes(doc: Doc, wordsPerMinute = 230): number {
	return Math.max(1, Math.round(wordCount(docText(doc)) / wordsPerMinute));
}

/**
 * A content date for display (`17 October 2026`). Formatted in UTC, so a `YYYY-MM-DD` date reads the
 * same in every time zone and on the server and the client alike.
 */
export function formatContentDate(isoDate: string, locale = "en-GB"): string {
	const date = new Date(`${isoDate.slice(0, 10)}T00:00:00Z`);
	if (Number.isNaN(date.getTime())) return isoDate;
	return new Intl.DateTimeFormat(locale, {
		day: "numeric",
		month: "long",
		year: "numeric",
		timeZone: "UTC",
	}).format(date);
}
// #endregion
