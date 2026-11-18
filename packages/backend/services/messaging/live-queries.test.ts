import { assertEquals } from "@std/assert";
import { groupsAddedAfterHistory, toConversationSummary } from "./live-queries.ts";

// #region A group newcomer's inbox row (PRD-C33, Decision #509)
const JOINED = "2026-11-18T12:00:00.000Z";
const BEFORE = "2026-11-18T11:00:00.000Z";
const AFTER = "2026-11-18T12:30:00.000Z";

Deno.test("groupsAddedAfterHistory names a group whose every message predates the viewer", () => {
	const joinedAt = new Map([
		["g-before", JOINED],
		["g-after", JOINED],
		["g-empty", JOINED],
		["dm", JOINED],
		["channel", JOINED],
	]);
	const added = groupsAddedAfterHistory([
		{ id: "g-before", kind: "group", last_message_at: BEFORE },
		// The viewer reads the newest message, so the tail is not empty and nothing is owed.
		{ id: "g-after", kind: "group", last_message_at: AFTER },
		// Empty is empty: the ordinary visibility rule decides.
		{ id: "g-empty", kind: "group", last_message_at: null },
		// Only a group bounds history; a DM and a channel read whole.
		{ id: "dm", kind: "dm", last_message_at: BEFORE },
		{ id: "channel", kind: "entity_channel", last_message_at: BEFORE },
		// No roster row for the viewer: no evidence they joined late.
		{ id: "g-unknown", kind: "group", last_message_at: BEFORE },
	], joinedAt);
	assertEquals([...added], ["g-before"]);
});

Deno.test("a newcomer's empty-to-them group dates its row from when they were added", () => {
	const row = {
		id: "g-before",
		ref: "cht-23456789ab",
		kind: "group",
		title: "Studio",
		photo_file_id: null,
		created_by_user_id: "founder",
		created_at: "2026-10-01T09:00:00.000Z",
		last_message_at: BEFORE,
	};
	const ctx = {
		viewer: undefined,
		otherIds: [],
		parties: new Map(),
		last: undefined,
		messageCount: 0,
		now: Date.parse(AFTER),
		viewerId: "newcomer",
	};
	assertEquals(toConversationSummary(row, { ...ctx, addedAt: JOINED }).updatedAt, JOINED);
	assertEquals(toConversationSummary(row, { ...ctx, addedAt: JOINED }).unread, false);
	assertEquals(toConversationSummary(row, { ...ctx, addedAt: JOINED }).preview, "");
	// Everyone else's empty thread still dates from its creation.
	assertEquals(toConversationSummary(row, ctx).updatedAt, row.created_at);
});
// #endregion
