import { assertEquals } from "@std/assert";
import {
	defaultConversationSortDir,
	isConversationSort,
	isConversationSortDir,
	isDefaultConversationSort,
	sortConversations,
} from "./conversation-filters.ts";
import type { ConversationSummary } from "../types/messaging-types.ts";

function row(id: string, title: string, updatedAt: string, unread = false): ConversationSummary {
	return {
		id,
		kind: "dm",
		relation: "dm",
		title,
		avatar: null,
		participants: [],
		preview: "",
		lastActivityLabel: "",
		lastActivityShort: "",
		updatedAt,
		unread,
		starred: false,
		folder: "primary",
		archived: false,
		muted: false,
		messageCount: 0,
		serviceId: null,
		serviceName: null,
		productId: null,
		productName: null,
		entityId: null,
		entityName: null,
	};
}

const ROWS = [
	row("c", "beta", "2026-10-02T00:00:00Z", true),
	row("a", "Alpha", "2026-10-03T00:00:00Z"),
	row("b", "gamma", "2026-10-01T00:00:00Z", true),
];

const ids = (list: readonly ConversationSummary[]) => list.map((c) => c.id);

// #region Sort
Deno.test("sortConversations: recent descending puts the latest activity first", () => {
	assertEquals(ids(sortConversations(ROWS, "recent", "desc")), ["a", "c", "b"]);
	assertEquals(ids(sortConversations(ROWS, "recent", "asc")), ["b", "c", "a"]);
});

Deno.test("sortConversations: name ignores case", () => {
	assertEquals(ids(sortConversations(ROWS, "name", "asc")), ["a", "c", "b"]);
	assertEquals(ids(sortConversations(ROWS, "name", "desc")), ["b", "c", "a"]);
});

Deno.test("sortConversations: unread first, newest within each group", () => {
	assertEquals(ids(sortConversations(ROWS, "unread", "desc")), ["c", "b", "a"]);
});

Deno.test("sortConversations: ties fall back to the id and the input is not mutated", () => {
	const tied = [row("z", "Same", "2026-10-01T00:00:00Z"), row("m", "Same", "2026-10-01T00:00:00Z")];
	assertEquals(ids(sortConversations(tied, "name", "asc")), ["m", "z"]);
	assertEquals(ids(sortConversations(tied, "name", "desc")), ["m", "z"]);
	assertEquals(ids(tied), ["z", "m"]);
});

Deno.test("defaultConversationSortDir: names open A–Z, the rest newest first", () => {
	assertEquals(defaultConversationSortDir("name"), "asc");
	assertEquals(defaultConversationSortDir("recent"), "desc");
	assertEquals(defaultConversationSortDir("unread"), "desc");
	assertEquals(isDefaultConversationSort("recent", "desc"), true);
	assertEquals(isDefaultConversationSort("recent", "asc"), false);
	assertEquals(isDefaultConversationSort("name", "asc"), false);
});

Deno.test("isConversationSort / isConversationSortDir: only the vocabulary passes", () => {
	assertEquals(isConversationSort("unread"), true);
	assertEquals(isConversationSort("priority"), false);
	assertEquals(isConversationSortDir("asc"), true);
	assertEquals(isConversationSortDir(undefined), false);
});
// #endregion
