import { assertEquals } from "@std/assert";
import type { ChatMessage } from "../projects/messages.ts";
import {
	applyMessageChange,
	DEFAULT_MESSAGE_EDIT_RULES,
	DeleteMessageSchema,
	EditMessageSchema,
	messageChatRef,
	messageEditOffer,
	type MessageEditRefusal,
	messageEditRefusalText,
	tombstoneOf,
} from "./message-edits.ts";

const SENT = "2026-11-24T12:00:00.000Z";
const at = (minutes: number) => Date.parse(SENT) + minutes * 60_000;

function message(over: Partial<ChatMessage> = {}): ChatMessage {
	return {
		id: "m1",
		type: "user",
		createdAt: SENT,
		timeLabel: "12:00",
		dayLabel: "Today",
		sender: null,
		isOwn: true,
		text: "Hello",
		delta: null,
		replyTo: null,
		attachments: [],
		audio: null,
		system: null,
		reactions: [{ emoji: "👍", count: 1, mine: false }],
		pinned: true,
		favorited: false,
		...over,
	};
}

Deno.test("messageEditOffer: the author edits inside the window and deletes at any time", () => {
	const rules = DEFAULT_MESSAGE_EDIT_RULES;
	assertEquals(messageEditOffer(message(), rules, at(0)), { edit: null, delete: null });
	assertEquals(messageEditOffer(message(), rules, at(15)), { edit: null, delete: null });
	assertEquals(messageEditOffer(message(), rules, at(15) + 1), { edit: "window", delete: null });
	assertEquals(messageEditOffer(message(), rules, at(60 * 24 * 30)), {
		edit: "window",
		delete: null,
	});
});

Deno.test("messageEditOffer: nobody else, nothing deleted, no quote card, no notice", () => {
	const rules = DEFAULT_MESSAGE_EDIT_RULES;
	const none = (r: MessageEditRefusal) => ({ edit: r, delete: r });
	assertEquals(messageEditOffer(message({ isOwn: false }), rules, at(1)), none("not_own"));
	assertEquals(messageEditOffer(message({ deleted: true }), rules, at(1)), none("deleted"));
	assertEquals(
		messageEditOffer(
			message({ quoteEventId: "6f0c2b8e-1a2b-4c3d-8e9f-0a1b2c3d4e5f" }),
			rules,
			at(1),
		),
		none("quote"),
	);
	assertEquals(messageEditOffer(message({ type: "system" }), rules, at(1)), none("system"));
});

Deno.test("messageEditOffer: a frozen room offers neither, whatever the clock", () => {
	for (const frozen of ["archived", "dispute"] as const) {
		const rules = { ...DEFAULT_MESSAGE_EDIT_RULES, frozen };
		assertEquals(messageEditOffer(message(), rules, at(1)), { edit: "frozen", delete: "frozen" });
	}
	assertEquals(
		messageEditRefusalText("frozen", { ...DEFAULT_MESSAGE_EDIT_RULES, frozen: "dispute" }),
		"A dispute is open on this work, so these messages stay as they are until it closes.",
	);
	assertEquals(
		messageEditRefusalText("window", { windowMinutes: 5, frozen: null }),
		"A message can be edited for 5 minutes after it is sent.",
	);
});

Deno.test("tombstoneOf keeps the place and drops everything it said", () => {
	const t = tombstoneOf(message({ text: "Secret", attachments: [] }));
	assertEquals([t.id, t.createdAt, t.isOwn, t.deleted], ["m1", SENT, true, true]);
	assertEquals([t.text, t.delta, t.reactions, t.pinned, t.audio], ["", null, [], false, null]);
});

Deno.test("applyMessageChange: an edit takes the words and stamp; a delete leaves a tombstone", () => {
	const edited = applyMessageChange(message(), {
		id: "m1",
		text: "Hello there",
		delta: null,
		editedAt: "2026-11-24T12:05:00.000Z",
		deleted: false,
	});
	assertEquals([edited.text, edited.editedAt, edited.deleted], [
		"Hello there",
		"2026-11-24T12:05:00.000Z",
		undefined,
	]);
	const gone = applyMessageChange(message(), {
		id: "m1",
		text: "",
		delta: null,
		editedAt: null,
		deleted: true,
	});
	assertEquals([gone.text, gone.deleted], ["", true]);
});

Deno.test("EditMessageSchema: words are required and the formatting must spell them", () => {
	const chat = { projectId: "prj-a", channelId: "cht-b" };
	assertEquals(EditMessageSchema.safeParse({ ...chat, text: "   " }).success, false);
	assertEquals(EditMessageSchema.safeParse({ ...chat, text: "x".repeat(8001) }).success, false);
	assertEquals(
		EditMessageSchema.safeParse({ ...chat, text: "hello", delta: { ops: [{ insert: "other" }] } })
			.success,
		false,
	);
	const ok = EditMessageSchema.safeParse({
		...chat,
		text: "hello",
		delta: { ops: [{ insert: "hel", attributes: { bold: true } }, { insert: "lo" }] },
	});
	assertEquals(ok.success, true);
	assertEquals(EditMessageSchema.parse({ ...chat, text: "hi" }).delta, null);
});

Deno.test("an edit names exactly one chat, and its ref is the send's", () => {
	assertEquals(EditMessageSchema.safeParse({ text: "hi" }).success, false);
	assertEquals(
		EditMessageSchema.safeParse({
			conversationId: "cht-a",
			projectId: "prj-b",
			channelId: "c",
			text: "hi",
		})
			.success,
		false,
	);
	assertEquals(DeleteMessageSchema.safeParse({ projectId: "prj-b" }).success, false);
	assertEquals(messageChatRef({ conversationId: "dm-mara" }), { kind: "thread", ref: "dm-mara" });
	assertEquals(messageChatRef({ projectId: "prj-b", channelId: "stg-c" }), {
		kind: "room",
		ref: "prj-b",
		channel: "stg-c",
	});
});
