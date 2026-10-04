import { z } from "zod";

/**
 * projects.message-rich — the formatted body and the reply reference a chat message carries, shared
 * by a project channel and a global-inbox conversation alike (they render through one bubble).
 *
 * ## The body is stored twice, and the two must agree
 *
 * A message keeps its plain text in `body` (what search, notifications, link previews, PII masking
 * and every pre-existing reader use) and its inline formatting as a Quill Delta in `body_delta`. The
 * Delta is never a second source of words: {@link messageDeltaText} of a stored Delta is, by
 * construction, exactly the plain body. The send schemas refuse a payload where they differ, and a
 * READ that finds them differing (the body was clamped, or rewritten by the PII mask) drops the Delta
 * and renders the plain body — so formatting can be lost, but a word the body does not contain can
 * never be shown.
 *
 * ## Only four marks
 *
 * The composer's selection bubble offers Bold · Italic · Underline · Strikethrough and nothing else,
 * so that is the whole vocabulary here. No block formats (a message is not a document), no links (a
 * written URL is linkified at render from the plain text, which is what keeps the `/exit` safety
 * interstitial on every external link), no embeds (attachments travel as `files.items` ids).
 *
 * Pure and dependency-free beyond zod, so the composer, the routes and the backend mappers share one
 * implementation of the normalisation and the agreement check.
 */

// #region Delta
/** The inline marks a message body may carry — the composer's selection bubble, exactly. */
export const MESSAGE_MARKS = ["bold", "italic", "underline", "strike"] as const;
export type MessageMark = (typeof MESSAGE_MARKS)[number];

/** A run's marks. Only `true` is representable — an absent key is the unformatted state. */
export const MessageDeltaAttributesSchema = z.strictObject({
	bold: z.literal(true).optional(),
	italic: z.literal(true).optional(),
	underline: z.literal(true).optional(),
	strike: z.literal(true).optional(),
});
export type MessageDeltaAttributes = z.infer<typeof MessageDeltaAttributesSchema>;

/** One run of text sharing the same marks. */
export const MessageDeltaOpSchema = z.strictObject({
	insert: z.string().min(1).max(8000),
	attributes: MessageDeltaAttributesSchema.optional(),
});
export type MessageDeltaOp = z.infer<typeof MessageDeltaOpSchema>;

/**
 * A normalised message Delta: the `{ ops }` envelope Quill's `getContents()` returns, reduced to
 * insert-only runs of text with the four marks, adjacent equal runs merged, the editor's trailing
 * newline and any surrounding whitespace removed. The op cap bounds a pathological alternation of
 * marks (one per character) at a size the `jsonb` column and a render can both afford.
 */
export const MessageDeltaSchema = z.strictObject({
	ops: z.array(MessageDeltaOpSchema).min(1).max(2000),
});
export type MessageDelta = z.infer<typeof MessageDeltaSchema>;

/** The plain text a Delta spells — the value `body` must equal. */
export function messageDeltaText(delta: MessageDelta): string {
	return delta.ops.map((op) => op.insert).join("");
}

/** Whether any run carries a mark; a Delta without one renders identically to its plain text. */
export function messageDeltaHasMarks(delta: MessageDelta): boolean {
	return delta.ops.some((op) => !!op.attributes && Object.keys(op.attributes).length > 0);
}

/** Keep only the four marks, and only when set to `true`; `undefined` when nothing survives. */
function cleanAttributes(raw: unknown): MessageDeltaAttributes | undefined {
	if (!raw || typeof raw !== "object") return undefined;
	const source = raw as Record<string, unknown>;
	const out: MessageDeltaAttributes = {};
	for (const mark of MESSAGE_MARKS) if (source[mark] === true) out[mark] = true;
	return Object.keys(out).length > 0 ? out : undefined;
}

/** Whether two runs carry the same marks (and so merge into one). */
function sameMarks(a: MessageDeltaAttributes | undefined, b: MessageDeltaAttributes | undefined) {
	return MESSAGE_MARKS.every((mark) => (a?.[mark] ?? false) === (b?.[mark] ?? false));
}

/**
 * Normalise raw editor ops into a storable {@link MessageDelta}, or `null` when no text remains.
 *
 * Accepts `unknown[]` because the input is whatever Quill produced plus whatever the caller appended
 * (the composer re-joins collapsed paste blocks as unformatted runs). Non-string inserts (embeds) and
 * non-mark attributes are dropped, adjacent runs with equal marks are merged, CRLF is folded to LF,
 * and the document is trimmed exactly as the composer trims its plain text — so the text of the
 * result is the `text` the payload carries, character for character.
 */
export function normalizeMessageDelta(rawOps: readonly unknown[]): MessageDelta | null {
	const runs: { insert: string; attributes?: MessageDeltaAttributes }[] = [];
	for (const raw of rawOps) {
		if (!raw || typeof raw !== "object") continue;
		const op = raw as { insert?: unknown; attributes?: unknown };
		if (typeof op.insert !== "string") continue;
		const insert = op.insert.replace(/\r\n?/g, "\n");
		if (insert.length === 0) continue;
		// A mark on a bare newline formats nothing a reader can see; Quill puts block formats there.
		const attributes = insert === "\n" ? undefined : cleanAttributes(op.attributes);
		const last = runs[runs.length - 1];
		if (last && sameMarks(last.attributes, attributes)) last.insert += insert;
		else runs.push(attributes ? { insert, attributes } : { insert });
	}

	// Trim the WHOLE document's leading and trailing whitespace, run by run, so a formatted word at
	// either edge keeps its marks while the editor's closing newline and stray spaces go.
	while (runs.length > 0) {
		const head = runs[0];
		head.insert = head.insert.replace(/^\s+/, "");
		if (head.insert.length > 0) break;
		runs.shift();
	}
	while (runs.length > 0) {
		const tail = runs[runs.length - 1];
		tail.insert = tail.insert.replace(/\s+$/, "");
		if (tail.insert.length > 0) break;
		runs.pop();
	}
	if (runs.length === 0) return null;

	const parsed = MessageDeltaSchema.safeParse({ ops: runs });
	return parsed.success ? parsed.data : null;
}

/**
 * The Delta a stored row may render, or `null` for the plain body.
 *
 * The read-side half of the agreement rule: a Delta is shown only when it parses AND spells the
 * exact body being shown. A clamped body, a PII-masked body, or a malformed column value all fall
 * back to plain text rather than rendering words the body does not contain.
 */
export function messageDeltaFor(raw: unknown, body: string): MessageDelta | null {
	if (raw === null || raw === undefined) return null;
	const parsed = MessageDeltaSchema.safeParse(raw);
	if (!parsed.success) return null;
	return messageDeltaText(parsed.data) === body ? parsed.data : null;
}
// #endregion

// #region Reply
/** What the quoted original carried besides (or instead of) text — labels a text-less quote. */
export const MessageReplyMedia = z.enum(["none", "attachment", "audio"]);
export type MessageReplyMedia = z.infer<typeof MessageReplyMedia>;

/**
 * The message a reply answers, as the quote at the top of the reply's bubble renders it.
 *
 * A projection, not the original: it is read with the reply so the quote draws in the same frame,
 * and it survives the original being out of the loaded window — the quote is still legible and a
 * press jumps to it when it is loaded. `available: false` covers an original that was deleted or that
 * this reader can no longer see; the quote then says so rather than vanishing, which would make the
 * reply read as a non-sequitur.
 */
export const MessageReplySchema = z.object({
	/** The original message's id (the jump target). */
	id: z.string().min(1).max(80),
	/** The original author's display name; null when the original is unavailable. */
	senderName: z.string().max(120).nullable(),
	/** Whether the viewer wrote the original — the quote names them "You". */
	isOwn: z.boolean(),
	/** A whitespace-collapsed plain excerpt of the original's body; "" when it had none. */
	excerpt: z.string().max(200),
	media: MessageReplyMedia,
	/** False when the original was deleted or is not readable by this viewer. */
	available: z.boolean(),
});
export type MessageReply = z.infer<typeof MessageReplySchema>;

/** The excerpt cap — one or two lines of a quote, never a second copy of the original. */
export const REPLY_EXCERPT_MAX = 160;

/** Collapse a body to the one-line excerpt a reply quote shows. */
export function replyExcerpt(text: string): string {
	const flat = text.replace(/\s+/g, " ").trim();
	// Counted in code points, not UTF-16 units, so the cut never halves an emoji into a broken glyph.
	const chars = Array.from(flat);
	return chars.length <= REPLY_EXCERPT_MAX
		? flat
		: `${chars.slice(0, REPLY_EXCERPT_MAX - 1).join("")}…`;
}

/** The quote for an original that no longer resolves for this viewer. */
export function unavailableReply(id: string): MessageReply {
	return { id, senderName: null, isOwn: false, excerpt: "", media: "none", available: false };
}
// #endregion
