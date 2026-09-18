import { assertEquals } from "@std/assert";
import { dmConversationId, dmHandleOf } from "@projective/types/messaging";
import type { MessagePage } from "@projective/types/projects";
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
				{ conversationId: channelId, text: id, attachmentIds: [], audio: null },
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
		{ conversationId: "dm-juno", text: "hello", attachmentIds: ["a1"], audio: null },
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
