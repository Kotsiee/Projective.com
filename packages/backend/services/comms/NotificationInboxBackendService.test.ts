import { assert, assertEquals } from "@std/assert";
import { NotificationInboxBackendService as Inbox } from "./NotificationInboxBackendService.ts";
import type { ReadActor } from "../read-actor.ts";

// The fixture branch: AUTH_BACKEND_LIVE is unset under `deno task test:unit`.
const actor = (userId: string): ReadActor => ({ userId, contextId: "", contextType: "personal" });

Deno.test("a guest is refused", async () => {
	assertEquals((await Inbox.list({}, actor(""))).status, 401);
	assertEquals((await Inbox.markSeen(actor(""))).status, 401);
});

Deno.test("list pages newest-first by created_at and filters", async () => {
	const a = actor("inbox-paging");
	const first = await Inbox.list({ limit: 2 }, a);
	assertEquals(first.data!.items.length, 2);
	assert(first.data!.items[0].createdAt > first.data!.items[1].createdAt);
	const second = await Inbox.list({ limit: 2, before: first.data!.nextCursor! }, a);
	assert(second.data!.items.every((i) => i.createdAt < first.data!.items[1].createdAt));

	const money = await Inbox.list({ category: "money" }, a);
	assert(money.data!.items.every((i) => i.category === "money"));
	assertEquals(money.data!.nextCursor, null);
	const unread = await Inbox.list({ unreadOnly: true }, a);
	assert(unread.data!.items.every((i) => i.isUnread));
	assertEquals(unread.data!.items.length, unread.data!.summary.unread);
});

Deno.test("state writes move the summary, per user", async () => {
	const a = actor("inbox-writes");
	const before = (await Inbox.summary(a)).data!;
	const [top] = (await Inbox.list({ unreadOnly: true, limit: 1 }, a)).data!.items;

	assertEquals((await Inbox.markRead([top.id], a)).data!.updated, 1);
	assertEquals((await Inbox.markRead([top.id], a)).data!.updated, 0);
	assertEquals((await Inbox.summary(a)).data!.unread, before.unread - 1);

	await Inbox.markAllRead("money", a);
	assertEquals((await Inbox.summary(a)).data!.byCategory.money, undefined);

	await Inbox.markSeen(a);
	assertEquals((await Inbox.summary(a)).data!.unseen, 0);

	assertEquals((await Inbox.archive([top.id], a)).data!.updated, 1);
	assertEquals((await Inbox.summary(a)).data!.total, before.total - 1);
	assert(!(await Inbox.list({}, a)).data!.items.some((i) => i.id === top.id));

	// Another user's inbox is untouched.
	assertEquals((await Inbox.summary(actor("inbox-other"))).data, before);
});

Deno.test("a non-timestamp cursor is a 422", async () => {
	assertEquals((await Inbox.list({ before: "yesterday-ish" }, actor("inbox-cursor"))).status, 422);
});

Deno.test("the archived view lists dismissed rows only", async () => {
	const a = actor("inbox-archived");
	assertEquals((await Inbox.list({ archived: true }, a)).data!.items.length, 0);
	const [top] = (await Inbox.list({}, a)).data!.items;
	await Inbox.archive([top.id], a);
	const archived = (await Inbox.list({ archived: true, unreadOnly: true }, a)).data!.items;
	assertEquals(archived.map((i) => i.id), [top.id]);
});
