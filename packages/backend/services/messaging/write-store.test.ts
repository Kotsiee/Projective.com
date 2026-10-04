import { assert, assertEquals } from "@std/assert";
import {
	dmConversationId,
	dmHandleOf,
	type SendConversationMessage,
} from "@projective/types/messaging";
import {
	messageDeltaText,
	type MessagePage,
	MessagePageSchema,
	normalizeMessageDelta,
} from "@projective/types/projects";
import { MessagingBackendService } from "./MessagingBackendService.ts";
import { findConversationMessagePage } from "./messages-fixtures.ts";
import { REPLY_REFUSAL_MESSAGE } from "../projects/message-replies.ts";
import {
	appendConversationMessage,
	buildStubConversationMessage,
	overlayConversationPage,
	sentConversationCount,
	stubViewerSender,
	writeOwnerOf,
} from "./write-store.ts";

/**
 * The messaging stub store, pinned.
 *
 * The claim under test is the one a stub write has to keep: a message sent a moment ago is still
 * there after the page reloads, on the page it belongs to, once — and nowhere else.
 */

const actor = { userId: "u-1", contextId: "", contextType: "personal" as const };
const other = { userId: "u-2", contextId: "", contextType: "personal" as const };

function page(channelId: string, ids: string[]): MessagePage {
	return {
		channelId,
		messages: ids.map((id) => ({
			...buildStubConversationMessage(
				{
					conversationId: channelId,
					text: id,
					delta: null,
					replyToId: null,
					attachmentIds: [],
					audio: null,
				},
				stubViewerSender(),
				0,
				0,
			),
			id,
		})),
		hasMore: false,
		nextCursor: null,
		pinned: [],
		permissions: { canPin: true },
		total: ids.length,
	};
}

Deno.test("dm ids: the unified id round-trips a handle, with or without its @", () => {
	assertEquals(dmConversationId("@juno"), "dm-juno");
	assertEquals(dmConversationId("juno"), "dm-juno");
	assertEquals(dmHandleOf("dm-juno"), "juno");
	assertEquals(dmHandleOf("grp-northwind"), null);
	assertEquals(dmHandleOf("dm-"), null);
});

Deno.test("write store: a sent message folds onto the latest page, once, for its own viewer", () => {
	const owner = writeOwnerOf(actor);
	const sent = buildStubConversationMessage(
		{
			conversationId: "dm-juno",
			text: "hello",
			delta: null,
			replyToId: null,
			attachmentIds: ["a1"],
			audio: null,
		},
		stubViewerSender(),
		sentConversationCount(owner, "dm-juno"),
		Date.UTC(2026, 8, 18, 9, 5),
	);
	assertEquals(sent.id, "sent-dm-juno-0");
	assertEquals(sent.isOwn, true);
	assertEquals(sent.timeLabel, "9:05 AM");
	assertEquals(sent.attachments.length, 1);
	appendConversationMessage(owner, "dm-juno", sent);
	assertEquals(sentConversationCount(owner, "dm-juno"), 1);

	const latest = overlayConversationPage(page("dm-juno", ["m-1"]), true, actor);
	assertEquals(latest.messages.map((m) => m.id), ["m-1", "sent-dm-juno-0"]);
	assertEquals(latest.total, 2);

	// Folded once: a page that already carries the row is not given it twice.
	const again = overlayConversationPage(latest, true, actor);
	assertEquals(again.messages.length, 2);

	// Only the LATEST page: an older page is history the send is by definition newer than.
	assertEquals(overlayConversationPage(page("dm-juno", ["m-0"]), false, actor).messages.length, 1);
	// Another conversation, and another viewer, see nothing.
	assertEquals(overlayConversationPage(page("dm-theo", ["m-9"]), true, actor).messages.length, 1);
	assertEquals(overlayConversationPage(page("dm-juno", ["m-1"]), true, other).messages.length, 1);
});

// #region Formatting and replies
/** A send payload into `conversationId`, plain and not a reply unless overridden. */
function send(
	conversationId: string,
	text: string,
	overrides: Partial<SendConversationMessage> = {},
): SendConversationMessage {
	return {
		conversationId,
		text,
		delta: null,
		replyToId: null,
		attachmentIds: [],
		audio: null,
		...overrides,
	};
}

/** `text` bolded end to end — a Delta that spells it exactly. */
function bolded(text: string) {
	return normalizeMessageDelta([{ insert: text, attributes: { bold: true } }]);
}

Deno.test("fixtures: every formatted message spells its text, and every quote is of its own thread", () => {
	for (const id of ["dm-mara", "grp-northwind"]) {
		const latest = findConversationMessagePage({ conversationId: id })!;
		// The page the route serialises must satisfy the SSOT: an over-long quote or a Delta the
		// schema rejects fails here rather than in a browser.
		MessagePageSchema.parse(latest);

		const formatted = latest.messages.filter((m) => m.delta !== null);
		assert(formatted.length >= 3, `${id}: the showcase carries its formatted beats`);
		for (const m of formatted) assertEquals(messageDeltaText(m.delta!), m.text);

		const replies = latest.messages.filter((m) => m.replyTo !== null);
		assertEquals(replies.length, 3, `${id}: three replies`);
		for (const reply of replies) {
			const original = latest.messages.find((m) => m.id === reply.replyTo!.id);
			assert(original, `${id}: a quote names a message of the same conversation`);
			assertEquals(reply.replyTo!.isOwn, original.isOwn);
			assertEquals(reply.replyTo!.available, true);
		}
		assert(replies.some((m) => m.replyTo!.isOwn), `${id}: one reply quotes the viewer`);
		assert(
			replies.some((m) => m.replyTo!.media === "audio" && m.replyTo!.excerpt === ""),
			`${id}: one reply quotes a text-less voice memo`,
		);
		// The pinned banner is the same projection, so its reply keeps its quote.
		assert(latest.pinned.some((m) => m.replyTo !== null), `${id}: a pinned reply`);
	}
});

Deno.test("a stub reply quotes its original — corpus or the viewer's own — and refuses any other id", async () => {
	const me = { userId: "u-replies", contextId: "", contextType: "personal" as const };
	const corpus = findConversationMessagePage({ conversationId: "dm-mara" })!.messages;
	const own = corpus.find((m) => m.text === "Could we tighten the spacing a touch?")!;

	const reply = await MessagingBackendService.sendMessage(
		send("dm-mara", "Done — tightened.", { replyToId: own.id }),
		me,
	);
	assert(reply.ok, reply.message);
	assertEquals(reply.data!.message.replyTo, {
		id: own.id,
		senderName: own.sender!.name,
		isOwn: true,
		excerpt: "Could we tighten the spacing a touch?",
		media: "none",
		available: true,
	});

	// A message sent a moment ago is as quotable as the corpus — it is on the page the composer shows.
	const followUp = await MessagingBackendService.sendMessage(
		send("dm-mara", "And the gutters.", { replyToId: reply.data!.message.id }),
		me,
	);
	assert(followUp.ok, followUp.message);
	assertEquals(followUp.data!.message.replyTo!.id, reply.data!.message.id);
	assertEquals(followUp.data!.message.replyTo!.excerpt, "Done — tightened.");

	// Another thread's message, and an id that names nothing: one refusal, on the field, in the words
	// the database trigger raises — and nothing stored.
	const foreign = findConversationMessagePage({ conversationId: "dm-theo" })!.messages.at(-1)!;
	for (const replyToId of [foreign.id, "dm-mara-m-9999"]) {
		const refused = await MessagingBackendService.sendMessage(
			send("dm-mara", "Lost quote.", { replyToId }),
			me,
		);
		assertEquals(refused.ok, false);
		assertEquals(refused.status, 422);
		assertEquals(refused.message, REPLY_REFUSAL_MESSAGE);
		assertEquals(refused.errors?.replyToId, "not_allowed");
	}
	assertEquals(sentConversationCount(writeOwnerOf(me), "dm-mara"), 2);
});

Deno.test("a stub send keeps its Delta only while it spells the text actually stored", async () => {
	const me = { userId: "u-format", contextId: "", contextType: "personal" as const };

	const text = "Ship it today";
	const kept = await MessagingBackendService.sendMessage(
		send("dm-mara", text, { delta: bolded(text) }),
		me,
	);
	assert(kept.ok, kept.message);
	assertEquals(kept.data!.message.delta, bolded(text));

	// dm-marcus is a pending hiring request, so the stub contact filter rewrites the body — and the
	// Delta, which spells the unmasked address, has to go with it (comms.tg_mask_dm_message_pii).
	const leaky = "Write to me at juno@example.com";
	const masked = await MessagingBackendService.sendMessage(
		send("dm-marcus", leaky, { delta: bolded(leaky) }),
		me,
	);
	assert(masked.ok, masked.message);
	assert(!masked.data!.message.text.includes("juno@example.com"));
	assertEquals(masked.data!.message.delta, null);
});
// #endregion
