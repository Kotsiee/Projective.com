import { assert, assertEquals, assertFalse } from "@std/assert";
import {
	type MessageDelta,
	messageDeltaFor,
	messageDeltaText,
	MessageReplySchema,
	normalizeMessageDelta,
	REPLY_EXCERPT_MAX,
	replyExcerpt,
	unavailableReply,
} from "./message-rich.ts";
import { SendProjectMessageSchema } from "./messages.ts";
import { SendConversationMessageSchema } from "../messaging/send.ts";

/**
 * The rich-message rules, pinned.
 *
 * Every one of them is a promise about WORDS. The composer, the routes, both live mappers and both
 * stub stores all lean on `normalizeMessageDelta` producing text identical to the trimmed plain body,
 * and on `messageDeltaFor` refusing any Delta that does not spell the body being shown — that is the
 * whole guarantee that formatting can be lost but a word the body does not contain can never render.
 * A type-checker sees none of it: a Delta that spells "call me at 555…" over a masked body is a
 * perfectly well-typed value.
 */

/** Shorthand for a raw editor op. */
function op(insert: unknown, attributes?: Record<string, unknown>) {
	return attributes ? { insert, attributes } : { insert };
}

/** A Delta the tests know is valid. */
function delta(...ops: MessageDelta["ops"]): MessageDelta {
	return { ops };
}

// #region normalizeMessageDelta
Deno.test("normalize: adjacent runs with the same marks merge into one", () => {
	assertEquals(
		normalizeMessageDelta([op("Hello "), op("there "), op("world")]),
		delta({ insert: "Hello there world" }),
	);
	assertEquals(
		normalizeMessageDelta([op("Bo", { bold: true }), op("ld", { bold: true }), op(" plain")]),
		delta({ insert: "Bold", attributes: { bold: true } }, { insert: " plain" }),
	);
	// Same marks in a different key order are still the same marks.
	assertEquals(
		normalizeMessageDelta([
			op("a", { bold: true, italic: true }),
			op("b", { italic: true, bold: true }),
		]),
		delta({ insert: "ab", attributes: { bold: true, italic: true } }),
	);
});

Deno.test("normalize: the document is trimmed at both edges, and a formatted edge keeps its marks", () => {
	assertEquals(
		normalizeMessageDelta([
			op("\n  "),
			op("Bold", { bold: true }),
			op(" middle "),
			op("end", { italic: true }),
			op("  \n"),
		]),
		delta(
			{ insert: "Bold", attributes: { bold: true } },
			{ insert: " middle " },
			{ insert: "end", attributes: { italic: true } },
		),
	);
	// Whitespace INSIDE a formatted edge run is trimmed too, without losing the run's marks.
	assertEquals(
		normalizeMessageDelta([op("  shout  ", { bold: true, underline: true })]),
		delta({ insert: "shout", attributes: { bold: true, underline: true } }),
	);
	// Interior whitespace is the author's, and is left alone.
	assertEquals(messageDeltaText(normalizeMessageDelta([op("a  \n\n  b\n")])!), "a  \n\n  b");
});

Deno.test("normalize: its text is the composer's trimmed plain text, character for character", () => {
	const raw = [
		op("  Draft "),
		op("v2", { bold: true }),
		op(" is ~"),
		op("in", { strike: true }),
		op("\n"),
	];
	const plain = raw.map((r) => r.insert as string).join("").trim();
	assertEquals(messageDeltaText(normalizeMessageDelta(raw)!), plain);
});

Deno.test("normalize: CRLF and a bare CR fold to LF", () => {
	assertEquals(
		normalizeMessageDelta([op("one\r\ntwo\rthree")]),
		delta({ insert: "one\ntwo\nthree" }),
	);
});

Deno.test("normalize: embeds, unknown attributes and false marks are dropped", () => {
	assertEquals(
		normalizeMessageDelta([
			op({ image: "https://example.com/x.png" }),
			op("text", { bold: false, italic: true, link: "https://example.com", color: "#f00" }),
		]),
		delta({ insert: "text", attributes: { italic: true } }),
	);
	// Nothing left of the attributes means no `attributes` key at all — not an empty object.
	const bare = normalizeMessageDelta([op("plain", { link: "https://example.com", bold: false })])!;
	assertEquals(bare, delta({ insert: "plain" }));
	assertFalse("attributes" in bare.ops[0]);
	// Non-op junk is skipped rather than throwing.
	assertEquals(normalizeMessageDelta([null, 7, "str", op("kept")]), delta({ insert: "kept" }));
});

Deno.test("normalize: a mark on a bare newline formats nothing and is dropped", () => {
	// Quill hangs BLOCK formats on the newline; a message has no blocks, so the newline is plain and
	// merges into its plain neighbours.
	assertEquals(
		normalizeMessageDelta([op("a"), op("\n", { bold: true }), op("b")]),
		delta({ insert: "a\nb" }),
	);
});

Deno.test("normalize: nothing but whitespace or embeds is null, never an empty Delta", () => {
	assertEquals(normalizeMessageDelta([]), null);
	assertEquals(normalizeMessageDelta([op("   \n\t"), op("\n", { bold: true })]), null);
	assertEquals(normalizeMessageDelta([op({ image: "x" }), op("")]), null);
});

Deno.test("normalize: a normalised Delta normalises to itself", () => {
	const once = normalizeMessageDelta([
		op(" Ship ", { bold: true }),
		op("it"),
		op(" today", { strike: true }),
	])!;
	assertEquals(normalizeMessageDelta(once.ops), once);
});
// #endregion

// #region messageDeltaFor
Deno.test("delta for: a Delta that spells the shown body is rendered", () => {
	const d = normalizeMessageDelta([op("Final", { bold: true }), op(" call")])!;
	assertEquals(messageDeltaFor(d, "Final call"), d);
	// The stored column is raw jsonb — a structurally equal object parses just the same.
	assertEquals(messageDeltaFor(JSON.parse(JSON.stringify(d)), "Final call"), d);
});

Deno.test("delta for: a clamped or rewritten body falls back to plain text", () => {
	const d = normalizeMessageDelta([op("Mail me at "), op("juno@example.com", { bold: true })])!;
	// The read clamps the body; the Delta now spells more than is shown.
	assertEquals(messageDeltaFor(d, "Mail me at juno"), null);
	// The PII mask rewrote the body; the Delta still spells the address.
	assertEquals(messageDeltaFor(d, "Mail me at [email hidden]"), null);
});

Deno.test("delta for: anything that is not a valid Delta is null", () => {
	for (
		const raw of [
			null,
			undefined,
			"Final call",
			[{ insert: "Final call" }],
			{ ops: [] },
			{ ops: [{ insert: "" }] },
			{ ops: [{ insert: "Final call", attributes: { color: "red" } }] },
			{ ops: [{ insert: "Final call", attributes: { bold: false } }] },
			{ ops: [{ insert: { image: "x" } }] },
			{ ops: [{ insert: "Final call" }], version: 2 },
		]
	) {
		assertEquals(messageDeltaFor(raw, "Final call"), null, JSON.stringify(raw) ?? String(raw));
	}
});
// #endregion

// #region Send schemas
Deno.test("send: a Delta must spell exactly the text, on both send schemas", () => {
	const d = normalizeMessageDelta([op("Ship", { bold: true }), op(" it")])!;
	const project = { projectId: "prj-1", channelId: "general" };
	const conversation = { conversationId: "dm-juno" };

	for (
		const [schema, base] of [
			[SendProjectMessageSchema, project],
			[SendConversationMessageSchema, conversation],
		] as const
	) {
		const agreed = schema.safeParse({ ...base, text: "Ship it", delta: d });
		assert(agreed.success);

		for (const text of ["Ship it now", "Ship it ", "ship it"]) {
			const refused = schema.safeParse({ ...base, text, delta: d });
			assertFalse(refused.success, text);
			assertEquals(refused.error?.issues.map((issue) => issue.path), [["delta"]]);
		}

		// Omitted, both new fields default to "plain, not a reply" — a pre-existing client still parses.
		const plain = schema.safeParse({ ...base, text: "Ship it" });
		assert(plain.success);
		assertEquals(plain.data?.delta, null);
		assertEquals(plain.data?.replyToId, null);
	}
});
// #endregion

// #region Replies
Deno.test("reply excerpt: whitespace collapses to one line", () => {
	assertEquals(replyExcerpt("  Could we\n\n push the\ttype?  "), "Could we push the type?");
	assertEquals(replyExcerpt(""), "");
	assertEquals(replyExcerpt(" \n "), "");
});

Deno.test("reply excerpt: capped with an ellipsis, never a second copy of the original", () => {
	const exact = "x".repeat(REPLY_EXCERPT_MAX);
	assertEquals(replyExcerpt(exact), exact);

	const long = replyExcerpt("y".repeat(REPLY_EXCERPT_MAX + 40));
	assertEquals(long.length, REPLY_EXCERPT_MAX);
	assert(long.endsWith("…"));
	// The cap holds AFTER collapsing, so whitespace never counts against it.
	assertEquals(replyExcerpt(`a${" ".repeat(500)}b`), "a b");
});

Deno.test("reply: an unavailable original names nobody and quotes nothing", () => {
	const gone = unavailableReply("00000000-0000-4000-a000-000000000001");
	assertEquals(MessageReplySchema.parse(gone), gone);
	assertEquals(gone.available, false);
	assertEquals(gone.senderName, null);
	assertEquals(gone.excerpt, "");
	assertEquals(gone.isOwn, false);
});
// #endregion
