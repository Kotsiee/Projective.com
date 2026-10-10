import { assertEquals } from "@std/assert";
import { type AttachmentSource, AttachmentSourceSchema } from "@projective/types/projects";
import {
	bySourceRecency,
	dmMessageHref,
	projectMessageHref,
	roomSegment,
} from "./live-attachment-source.ts";
import { findAttachmentSources } from "./workspace-fixtures.ts";
import { findConversations } from "./conversation-fixtures.ts";
import { findConversationMessagePage } from "./messages-fixtures.ts";

const ROOM = "178b022d-abe2-4784-bbef-d740aa0ed5c0";

// #region Addresses
Deno.test("dmMessageHref and projectMessageHref carry the message as ?m=", () => {
	assertEquals(dmMessageHref("thread-1", "m-1"), "/messages/thread-1?m=m-1");
	assertEquals(
		projectMessageHref("prj-67ss4hwneu", "stg-3f4gvyycwv", "m-1"),
		"/projects/prj-67ss4hwneu/stg-3f4gvyycwv/chat?m=m-1",
	);
});

Deno.test("roomSegment: a stage's shared room is its slug, never its uuid", () => {
	assertEquals(
		roomSegment({ id: ROOM, stage_id: "s-1", visibility: "stage_all" }, "stg-3f4gvyycwv", null),
		"stg-3f4gvyycwv",
	);
	assertEquals(
		roomSegment({ id: ROOM, stage_id: "s-1", visibility: "stage_all" }, null, null),
		null,
	);
});

Deno.test("roomSegment: a project-wide primary room is `discussion`; a side room keeps its id", () => {
	assertEquals(
		roomSegment({ id: ROOM, stage_id: null, visibility: "project_all" }, null, ROOM),
		"discussion",
	);
	assertEquals(
		roomSegment({ id: ROOM, stage_id: "s-1", visibility: "stage_all" }, "stg-x", ROOM),
		"stg-x",
	);
	assertEquals(
		roomSegment({ id: ROOM, stage_id: "s-1", visibility: "stage_all" }, null, ROOM),
		"discussion",
	);
	assertEquals(
		roomSegment({ id: ROOM, stage_id: "s-1", visibility: "team_private" }, "stg-x", null),
		ROOM,
	);
	assertEquals(
		roomSegment({ id: ROOM, stage_id: null, visibility: "project_all" }, null, "other"),
		ROOM,
	);
});

Deno.test("bySourceRecency: newest first, id as the tiebreak", () => {
	const at = (messageId: string, createdAt: string) =>
		({ messageId, createdAt }) as AttachmentSource;
	const sorted = [
		at("a", "2026-10-01T00:00:00.000Z"),
		at("c", "2026-10-02T00:00:00.000Z"),
		at("b", "2026-10-02T00:00:00.000Z"),
	].sort(bySourceRecency);
	assertEquals(sorted.map((s) => s.messageId), ["c", "b", "a"]);
});
// #endregion

// #region Fixture branch
Deno.test("findAttachmentSources: a fixture tile resolves to its message, schema-valid", () => {
	let found = false;
	for (const conversation of findConversations({}).conversations) {
		const page = findConversationMessagePage({ conversationId: conversation.id, limit: 100 });
		const message = page?.messages.find((m) => m.attachments.length > 0);
		if (!page || !message) continue;
		const tile = message.attachments[0];
		for (const key of [tile.id, `${message.id}-${tile.id}`]) {
			const sources = findAttachmentSources(key, conversation.id);
			assertEquals(sources.map((s) => s.messageId), [message.id]);
			AttachmentSourceSchema.parse(sources[0]);
			assertEquals(
				sources[0].href,
				`/messages/${encodeURIComponent(conversation.id)}?m=${encodeURIComponent(message.id)}`,
			);
		}
		found = true;
		break;
	}
	assertEquals(found, true);
});

Deno.test("findAttachmentSources: no conversation, or an unknown key, is an empty answer", () => {
	assertEquals(findAttachmentSources("anything", null), []);
	assertEquals(findAttachmentSources("not-a-tile", "dm-nobody-here"), []);
});
// #endregion
