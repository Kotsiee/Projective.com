import { assert, assertEquals } from "@std/assert";
import type { InboxFolder } from "@projective/types/messaging";
import type { ReadActor } from "../read-actor.ts";
import { MessagingBackendService } from "./MessagingBackendService.ts";
import { clearStubFolders } from "./folder-store.ts";

/*
 * Inbox folder transitions through the fat service's stub branch (a tokenless actor selects it
 * whatever the environment's gate): a reply files the replier's own copy of a request in Primary, a
 * manual move files it anywhere, and every list partition follows the folder. The database twin of
 * each rule is pinned by the SQL probe and `packages/types/messaging/folders.test.ts`.
 */

const actorOf = (userId: string): ReadActor => ({
	userId,
	contextId: userId,
	contextType: "personal",
});

async function idsIn(folder: InboxFolder, actor: ReadActor): Promise<string[]> {
	const res = await MessagingBackendService.conversations({ folder }, actor);
	assert(res.ok && res.data, res.message);
	return res.data.page.conversations.map((c) => c.id);
}

Deno.test("a hiring request opens in Requests, and replying files the replier's copy in Primary", async () => {
	clearStubFolders();
	const me = actorOf("folders-reply");
	assert((await idsIn("requests", me)).includes("dm-marcus"));
	assert(!(await idsIn("primary", me)).includes("dm-marcus"));

	const sent = await MessagingBackendService.sendMessage(
		{
			conversationId: "dm-marcus",
			text: "Thanks — happy to talk.",
			delta: null,
			replyToId: null,
			attachmentIds: [],
			audio: null,
		},
		me,
	);
	assert(sent.ok, sent.message);

	assert(!(await idsIn("requests", me)).includes("dm-marcus"));
	assert((await idsIn("primary", me)).includes("dm-marcus"));
	const detail = await MessagingBackendService.conversation("dm-marcus", me);
	assert(detail.ok && detail.data);
	assertEquals(detail.data.detail.folder, "primary");
});

Deno.test("a folder is per participant: one viewer's reply leaves another's Requests untouched", async () => {
	clearStubFolders();
	const replier = actorOf("folders-replier");
	const bystander = actorOf("folders-bystander");
	const sent = await MessagingBackendService.sendMessage(
		{
			conversationId: "dm-ivy",
			text: "Let's set up a call.",
			delta: null,
			replyToId: null,
			attachmentIds: [],
			audio: null,
		},
		replier,
	);
	assert(sent.ok, sent.message);
	assert((await idsIn("primary", replier)).includes("dm-ivy"));
	assert((await idsIn("requests", bystander)).includes("dm-ivy"));
});

Deno.test("setFolder moves a conversation between folders and the archived flag follows", async () => {
	clearStubFolders();
	const me = actorOf("folders-move");
	const archived = await MessagingBackendService.setFolder("dm-ivy", "archived", me);
	assert(archived.ok && archived.data, archived.message);
	assertEquals(archived.data, { id: "dm-ivy", folder: "archived" });
	assert((await idsIn("archived", me)).includes("dm-ivy"));
	assert(!(await idsIn("requests", me)).includes("dm-ivy"));

	const listed = await MessagingBackendService.conversations({ view: "archived" }, me);
	assert(listed.ok && listed.data);
	const row = listed.data.page.conversations.find((c) => c.id === "dm-ivy");
	assertEquals(row?.archived, true);

	const back = await MessagingBackendService.setFolder("dm-ivy", "primary", me);
	assert(back.ok, back.message);
	assert((await idsIn("primary", me)).includes("dm-ivy"));
	assert(!(await idsIn("archived", me)).includes("dm-ivy"));
});

Deno.test("a reply into an archived conversation leaves it archived", async () => {
	clearStubFolders();
	const me = actorOf("folders-archived-reply");
	assert((await MessagingBackendService.setFolder("dm-marcus", "archived", me)).ok);
	const sent = await MessagingBackendService.sendMessage(
		{
			conversationId: "dm-marcus",
			text: "One more thing.",
			delta: null,
			replyToId: null,
			attachmentIds: [],
			audio: null,
		},
		me,
	);
	assert(sent.ok, sent.message);
	assert((await idsIn("archived", me)).includes("dm-marcus"));
});

Deno.test("setFolder refuses a guest and an unknown conversation", async () => {
	clearStubFolders();
	const guest = await MessagingBackendService.setFolder("dm-ivy", "archived", actorOf(""));
	assertEquals(guest.status, 401);
	const missing = await MessagingBackendService.setFolder(
		"thread-that-does-not-exist",
		"archived",
		actorOf("x"),
	);
	assertEquals(missing.status, 404);
});
