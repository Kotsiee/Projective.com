import { assertEquals } from "@std/assert";
import {
	ChatRefSchema,
	conversationPath,
	projectChatRef,
	SendConversationMessageSchema,
	sendInputOf,
	SendMessageInputSchema,
	threadChatRef,
} from "./send.ts";

/**
 * messaging.send — the address the one send door dispatches on (Decision #339 ruling N1) and the two
 * wires that reach it.
 */

const REF = "cht-23456789ab";

Deno.test("projectChatRef: a cht- channel is the thread seen through its project; anything else a room", () => {
	assertEquals(projectChatRef("prj-23456789ab", REF), {
		kind: "thread",
		ref: REF,
		project: "prj-23456789ab",
	});
	assertEquals(projectChatRef("prj-23456789ab", "discussion"), {
		kind: "room",
		ref: "prj-23456789ab",
		channel: "discussion",
	});
	assertEquals(projectChatRef("prj-23456789ab", "stg-23456789ab").kind, "room");
	// A fixture project slug carries no stamp: only a real `prj-` address names a project to stamp.
	assertEquals(projectChatRef("aurora-rebrand", REF), { kind: "thread", ref: REF });
});

Deno.test("ChatRefSchema: a thread is a cht- ref, a room a stg-/prj- address and its channel", () => {
	assertEquals(ChatRefSchema.safeParse(threadChatRef(REF)).success, true);
	assertEquals(
		ChatRefSchema.safeParse({ kind: "thread", ref: "11111111-1111-4111-8111-111111111111" })
			.success,
		false,
	);
	assertEquals(
		ChatRefSchema.safeParse({ kind: "room", ref: "prj-23456789ab", channel: "discussion" }).success,
		true,
	);
});

Deno.test("the conversation wire carries the same message the door takes", () => {
	const wire = SendConversationMessageSchema.parse({ conversationId: "dm-mara", text: "Hi" });
	const input = sendInputOf(wire);
	assertEquals(input, SendMessageInputSchema.parse({ text: "Hi" }));
	assertEquals(SendMessageInputSchema.safeParse({ text: "  " }).success, false);
});

Deno.test("conversationPath: the inbox route of an address, landing on a message", () => {
	assertEquals(conversationPath(REF), `/messages/${REF}`);
	assertEquals(conversationPath(REF, "m 1"), `/messages/${REF}?m=m%201`);
});
