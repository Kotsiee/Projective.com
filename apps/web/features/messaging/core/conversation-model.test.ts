import { assertEquals } from "@std/assert";
import { addressAfterSend, conversationHref, movedConversationHref } from "./conversation-model.ts";

/**
 * conversation-model — the address rules the `/messages` routes and the composer share (Decision #339
 * ruling N1): a conversation routes by its `cht-` ref; a `dm-<handle>` moves to the pair's thread
 * once it exists — server-side with a 303, client-side with `replaceState` after the first send.
 */

const REF = "cht-23456789ab";

Deno.test("conversationHref: the inbox route of an address", () => {
	assertEquals(conversationHref(REF), `/messages/${REF}`);
	assertEquals(conversationHref("dm-mara"), "/messages/dm-mara");
});

Deno.test("addressAfterSend: the first send to a dm- page moves it to the thread, tab kept", () => {
	assertEquals(addressAfterSend("/messages/dm-mara", "dm-mara", REF), `/messages/${REF}`);
	assertEquals(
		addressAfterSend("/messages/dm-mara/files", "dm-mara", REF),
		`/messages/${REF}/files`,
	);
});

Deno.test("addressAfterSend: nothing moves off the conversation, at the ref, or without one", () => {
	// A pop-out over another page sends to the dm- address, but the page is not that conversation.
	assertEquals(addressAfterSend("/projects/prj-23456789ab", "dm-mara", REF), null);
	assertEquals(addressAfterSend("/messages/dm-marab", "dm-mara", REF), null);
	// Already at the thread, or a fixture id that never moves, or no ref in the answer.
	assertEquals(addressAfterSend(`/messages/${REF}`, REF, REF), null);
	assertEquals(addressAfterSend("/messages/grp-northwind", "grp-northwind", REF), null);
	assertEquals(addressAfterSend("/messages/dm-mara", "dm-mara", null), null);
});

Deno.test("movedConversationHref: a moved address keeps its tab and query", () => {
	const location = `/messages/${REF}`;
	assertEquals(
		movedConversationHref(new URL("https://x.test/messages/dm-mara"), location),
		location,
	);
	assertEquals(
		movedConversationHref(new URL("https://x.test/messages/dm-mara/members?m=1"), location),
		`${location}/members?m=1`,
	);
});
