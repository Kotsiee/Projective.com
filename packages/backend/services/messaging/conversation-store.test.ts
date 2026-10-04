import { assert, assertEquals } from "@std/assert";
import type { MessagingContact } from "@projective/types/messaging";
import type { ReadActor } from "../read-actor.ts";
import {
	addCreatedMembers,
	createdConversationsFor,
	defaultGroupTitle,
	findCreatedConversation,
	overlayCreatedConversations,
	rememberCreatedDm,
	rememberCreatedGroup,
	setStubGroupPhoto,
	withStubPhoto,
} from "./conversation-store.ts";
import { appendConversationMessage, writeOwnerOf } from "./write-store.ts";
import { findConversationSummary } from "./conversation-fixtures.ts";

/*
 * The store is the stub path's answer to "does a group I just created still exist after a reload",
 * and to the visibility rule that decides when it appears in the inbox. Both are claims a reader
 * checks by eye; both are pinned here so a refactor that breaks either fails a test first.
 */

const me: ReadActor = { userId: "test-user", contextId: "", contextType: "personal" };
const other: ReadActor = { userId: "someone-else", contextId: "", contextType: "personal" };

function contact(id: string, name: string): MessagingContact {
	return { id, name, avatar: null, handle: id, context: null, relation: "dm", online: false };
}

const mara = contact("mara-t", "Mara Ellison");
const priya = contact("priya-t", "Priya Nair");
const lena = contact("lena-t", "Lena Fischer");

Deno.test("a nameless group is titled after its members' first names", () => {
	assertEquals(defaultGroupTitle([]), "New group");
	assertEquals(defaultGroupTitle([mara, priya]), "Mara, Priya");
	assertEquals(
		defaultGroupTitle([mara, priya, lena, contact("x", "Noah B")]),
		"Mara, Priya, Lena +1",
	);
});

Deno.test("a created group resolves by id and lists for its starter at once, empty, and for nobody else", () => {
	const group = rememberCreatedGroup(me, "  Design crew ", [mara, priya]);
	assertEquals(group.kind, "group");
	assertEquals(group.title, "Design crew");
	assertEquals(group.participants.length, 2);
	assert(group.id.startsWith("grp-design-crew-"));
	// No photo until one is set — the inbox paints the group fallback meanwhile.
	assertEquals(group.avatar, null);

	// Resolvable by id, and through the fixture lookup the detail/messages reads go through.
	assertEquals(findCreatedConversation(group.id)?.id, group.id);
	assertEquals(findConversationSummary(group.id)?.title, "Design crew");

	// The starter's list shows it straight away, still empty; nobody else's does.
	assert(createdConversationsFor(me).some((c) => c.id === group.id));
	assert(!createdConversationsFor(other).some((c) => c.id === group.id));
	const empty = { conversations: [], hasMore: false, nextCursor: null, total: 0 };
	const fresh = overlayCreatedConversations(empty, {}, me);
	assertEquals(fresh.conversations.map((c) => c.id), [group.id]);
	assertEquals(fresh.conversations[0].messageCount, 0);

	// The first message lands → the count is folded in from the write store.
	appendConversationMessage(writeOwnerOf(me), group.id, {
		id: "m1",
		type: "user",
		createdAt: "2026-07-17T16:21:00Z",
		timeLabel: "4:21 PM",
		dayLabel: "Today",
		sender: { id: "test-user", name: "Me", avatar: null, handle: null },
		isOwn: true,
		text: "hello",
		delta: null,
		replyTo: null,
		attachments: [],
		audio: null,
		system: null,
		reactions: [],
		pinned: false,
		favorited: false,
	});
	const page = overlayCreatedConversations(empty, {}, me);
	assertEquals(page.conversations.map((c) => c.id), [group.id]);
	assertEquals(page.conversations[0].messageCount, 1);
	assertEquals(page.total, 1);
	// …and not for somebody else.
	assertEquals(overlayCreatedConversations(empty, {}, other).conversations.length, 0);
});

Deno.test("a DM is remembered idempotently under its unified id", () => {
	const first = rememberCreatedDm(me, contact("ivy-t", "Ivy Chen"));
	const again = rememberCreatedDm(me, contact("ivy-t", "Ivy Chen"));
	assertEquals(first.id, "dm-ivy-t");
	assertEquals(again, first);
});

Deno.test("adding a third person turns a DM into a group; a repeat adds nobody", () => {
	const dm = rememberCreatedDm(me, contact("theo-t", "Theo Marsh"));
	const { summary, added } = addCreatedMembers(me, dm, [lena, contact("theo-t", "Theo Marsh")]);
	assertEquals(added, 1);
	assertEquals(summary.kind, "group");
	assertEquals(summary.title, "Theo, Lena");
	assertEquals(summary.participants.length, 2);
	// The store now answers with the group for the SAME id.
	assertEquals(findCreatedConversation(dm.id)?.kind, "group");
	const repeat = addCreatedMembers(me, summary, [lena]);
	assertEquals(repeat.added, 0);
	assertEquals(repeat.summary.participants.length, 2);
});

Deno.test("the overlay replaces a corpus row of the same id rather than duplicating it, newest first", () => {
	const dm = rememberCreatedDm(me, contact("omar-t", "Omar Haddad"));
	appendConversationMessage(writeOwnerOf(me), dm.id, {
		id: "m2",
		type: "user",
		createdAt: "2026-07-17T16:22:00Z",
		timeLabel: "4:22 PM",
		dayLabel: "Today",
		sender: { id: "test-user", name: "Me", avatar: null, handle: null },
		isOwn: true,
		text: "hi",
		delta: null,
		replyTo: null,
		attachments: [],
		audio: null,
		system: null,
		reactions: [],
		pinned: false,
		favorited: false,
	});
	const corpusRow = {
		...dm,
		kind: "dm" as const,
		messageCount: 9,
		updatedAt: "2026-01-01T00:00:00Z",
	};
	const page = overlayCreatedConversations(
		{ conversations: [corpusRow], hasMore: false, nextCursor: null, total: 1 },
		{},
		me,
	);
	assertEquals(page.conversations.filter((c) => c.id === dm.id).length, 1);
	// The store is module state shared across tests, so other created rows may join too; the count
	// must agree with the rows drawn, and the replaced row must not be counted twice.
	assertEquals(page.total, page.conversations.length);
	// A partition the row is not in withholds it.
	const archivedOnly = overlayCreatedConversations(
		{ conversations: [], hasMore: false, nextCursor: null, total: 0 },
		{ view: "archived" },
		me,
	);
	assertEquals(archivedOnly.conversations.length, 0);
});

Deno.test("a group photo set in this process applies to that group only, and can be cleared", () => {
	const group = rememberCreatedGroup(me, "Photo crew", [mara, priya]);
	const dm = rememberCreatedDm(me, contact("sam-t", "Sam Ortiz"));
	assertEquals(withStubPhoto(group).avatar, null);

	setStubGroupPhoto(group.id, "https://cdn.test/avatars/g/sm.webp");
	assertEquals(withStubPhoto(group).avatar, "https://cdn.test/avatars/g/sm.webp");
	// It is the group's picture, so every member's list shows it.
	const empty = { conversations: [], hasMore: false, nextCursor: null, total: 0 };
	assertEquals(
		overlayCreatedConversations(empty, {}, me).conversations.find((c) => c.id === group.id)?.avatar,
		"https://cdn.test/avatars/g/sm.webp",
	);

	// A DM's picture is a person — a photo keyed to its id never applies.
	setStubGroupPhoto(dm.id, "https://cdn.test/avatars/d/sm.webp");
	assertEquals(withStubPhoto(dm).avatar, dm.avatar);

	setStubGroupPhoto(group.id, null);
	assertEquals(withStubPhoto(group).avatar, null);
});
