/**
 * message-length — how much of a message body a bubble shows at first.
 *
 * Three presentations, decided from the TEXT alone so the server render and the hydrated island
 * agree and a long message never reflows after load:
 *
 *  - **inline** — short enough to read in place.
 *  - **collapsible** — over {@link COLLAPSE_CHARS} characters OR over {@link COLLAPSE_LINES} lines,
 *    whichever is hit first. The bubble shows {@link COLLAPSED_LINES} lines with a Show more / Show
 *    less toggle beneath them.
 *  - **card** — over {@link CARD_CHARS} characters. Expanding a wall of text in the conversation would
 *    push everything around it off screen, so the body becomes a card that opens the full text in a
 *    dialog instead.
 *
 * "Lines" are the lines the AUTHOR wrote (line breaks), not the lines the bubble happens to wrap to
 * at the current width: the wrap count depends on the viewport and font, so it would collapse a
 * message on a phone that reads in full on a desktop, and could only be known after layout. The
 * character threshold is what catches a long unbroken paragraph.
 *
 * Characters are counted in code points, so an emoji is one character as a reader would count it.
 */

// #region Thresholds
/** Characters past which a message collapses. */
export const COLLAPSE_CHARS = 750;
/** Author-written lines past which a message collapses. */
export const COLLAPSE_LINES = 10;
/** Lines a collapsed message shows. */
export const COLLAPSED_LINES = 4;
/** Characters past which a message is shown as a card that opens a dialog. */
export const CARD_CHARS = 4000;
// #endregion

// #region Classification
/** How a message body is first presented. */
export type MessageLength = "inline" | "collapsible" | "card";

/** The number of characters a reader would count (code points, not UTF-16 units). */
export function charCount(text: string): number {
	let n = 0;
	for (const _ of text) n++;
	return n;
}

/** The number of lines the author wrote. An empty body has none. */
export function lineCount(text: string): number {
	return text.length === 0 ? 0 : text.split(/\r\n|\r|\n/).length;
}

/** Classify a body against the thresholds — card first, because it is the stronger rule. */
export function messageLengthOf(text: string): MessageLength {
	const chars = charCount(text);
	if (chars > CARD_CHARS) return "card";
	if (chars > COLLAPSE_CHARS || lineCount(text) > COLLAPSE_LINES) return "collapsible";
	return "inline";
}
// #endregion

// #region Card summary
/** The longest preview a long-message card shows. */
const PREVIEW_CHARS = 160;

/** What a long-message card says about the body it stands for. */
export interface LongMessageSummary {
	/** The opening of the message, collapsed to one line. */
	preview: string;
	words: number;
	chars: number;
}

/** Summarise a long body for its card: an opening line, and how much there is to read. */
export function longMessageSummary(text: string): LongMessageSummary {
	const flat = text.replace(/\s+/g, " ").trim();
	const points = Array.from(flat);
	const preview = points.length <= PREVIEW_CHARS
		? flat
		: `${points.slice(0, PREVIEW_CHARS - 1).join("")}…`;
	const words = flat.length === 0 ? 0 : flat.split(" ").length;
	return { preview, words, chars: charCount(text) };
}
// #endregion
