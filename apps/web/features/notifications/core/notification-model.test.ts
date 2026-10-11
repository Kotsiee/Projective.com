import { assertEquals } from "@std/assert";
import { FakeTime } from "@std/testing/time";
import type { NotificationInboxItem } from "@projective/types/comms";
import { NOTIFICATION_FIXTURES } from "@server/services/comms/notification-fixtures.ts";
import {
	createAnnouncer,
	hasArrivals,
	inboxHref,
	listQuery,
	mergeHead,
	metaLine,
	parseTab,
	parseView,
	tabUnread,
} from "./notification-model.ts";

const [a, b, c] = NOTIFICATION_FIXTURES as NotificationInboxItem[];

Deno.test("deep links decode, and marketing never becomes a tab", () => {
	assertEquals(parseTab("money"), "money");
	assertEquals(parseTab("marketing"), "all");
	assertEquals(parseView("archived"), "archived");
	assertEquals(parseView("bogus"), "all");
	assertEquals(inboxHref("all", "all"), "/notifications");
	assertEquals(inboxHref("work", "unread"), "/notifications?category=work&view=unread");
	assertEquals(
		listQuery("all", "archived", "2026-01-01", 5),
		"limit=5&archived=true&before=2026-01-01",
	);
});

Deno.test("tab counts read the sparse summary", () => {
	const s = { unread: 4, unseen: 1, total: 9, byCategory: { money: 3 } };
	assertEquals(tabUnread(s, "all"), 4);
	assertEquals(tabUnread(s, "money"), 3);
	assertEquals(tabUnread(s, "work"), 0);
	assertEquals(tabUnread(null, "all"), 0);
});

Deno.test("the meta line is time · context · group", () => {
	const now = Date.parse(c.createdAt) + 3 * 3_600_000;
	assertEquals(metaLine(c, now), "3h ago · Messages · 3 updates");
	assertEquals(metaLine(b, Date.parse(b.createdAt) + 60_000), "1m ago · Brand system");
});

Deno.test("a live merge prepends only newer unknown rows and refreshes known ones", () => {
	const readB = { ...b, isUnread: false };
	const merged = mergeHead([b, c], [a, readB]);
	assertEquals(merged.added, 1);
	assertEquals(merged.items.map((i) => i.id), [a.id, b.id, c.id]);
	assertEquals(merged.items[1].isUnread, false);
	// An unknown row OLDER than the head is left to "Load more".
	assertEquals(mergeHead([a], [c]).added, 0);
});

Deno.test("arrivals: total or unseen rising, never a write lowering them", () => {
	const s = { unread: 2, unseen: 2, total: 5, byCategory: {} };
	assertEquals(hasArrivals(null, s), false);
	assertEquals(hasArrivals(s, { ...s, total: 6 }), true);
	assertEquals(hasArrivals(s, { ...s, unseen: 0, unread: 1 }), false);
});

Deno.test("the announcer speaks at once, then sums a burst into one message", () => {
	using time = new FakeTime(0);
	const said: string[] = [];
	const announcer = createAnnouncer((m) => said.push(m), 8_000);
	announcer.push(1);
	assertEquals(said, ["1 new notification"]);
	for (let i = 0; i < 5; i++) {
		time.tick(1_000);
		announcer.push(1);
	}
	assertEquals(said.length, 1);
	time.tick(3_000);
	assertEquals(said, ["1 new notification", "5 new notifications"]);
	announcer.dispose();
});
