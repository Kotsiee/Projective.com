import { assert, assertEquals } from "@std/assert";
import {
	compareRankedContacts,
	contactMatches,
	CreateConversationSchema,
	deriveContactRank,
	emptyEvidence,
	groupContactsByTier,
	interactionLabel,
	type RankedContact,
	sortRankedContacts,
	uniqueContactIds,
} from "./contacts.ts";

/*
 * The ranking is a CLAIM about the reader's own relationships — "you follow each other", "you were
 * on Aurora Rebrand together" — and the failure mode of a wrong one is a confident statement about
 * somebody the reader knows better than we do. So the derivation is pinned directly, tier by tier,
 * with the null states the brief calls out (a brand-new account with zero interactions) first.
 */

const NOW = Date.parse("2026-07-17T16:20:00Z");

function ranked(
	id: string,
	tier: RankedContact["tier"],
	lastInteractionAt: string | null,
	name = id,
): RankedContact {
	return {
		id,
		name,
		avatar: null,
		handle: id,
		context: null,
		relation: "dm",
		online: false,
		tier,
		reason: null,
		lastInteractionAt,
		lastInteractionLabel: null,
	};
}

// #region Null states
Deno.test("no evidence at all ranks as `none` with no reason and no instant", () => {
	const rank = deriveContactRank(emptyEvidence());
	assertEquals(rank, { tier: "none", reason: null, lastInteractionAt: null });
});

Deno.test("being followed WITHOUT following back earns no tier — it is their choice, not the viewer's", () => {
	const rank = deriveContactRank({ ...emptyEvidence(), followsMe: "2026-07-01T00:00:00Z" });
	assertEquals(rank.tier, "none");
	// …but the instant still counts toward recency, so it is not lost.
	assertEquals(rank.lastInteractionAt, "2026-07-01T00:00:00Z");
});
// #endregion

// #region Tier precedence
Deno.test("a shared workspace outranks everything, and names the most recently joined one", () => {
	const rank = deriveContactRank({
		sharedEntities: [
			{ kind: "team", id: "t1", name: "Northwind Studio", since: "2025-01-01T00:00:00Z" },
			{ kind: "business", id: "b1", name: "Monarch Labs", since: "2026-03-01T00:00:00Z" },
		],
		followsThem: "2026-07-10T00:00:00Z",
		followsMe: "2026-07-11T00:00:00Z",
		collaborations: [{ projectId: "p", title: "X", completed: true, at: "2026-07-12T00:00:00Z" }],
		lastMessageAt: "2026-07-16T00:00:00Z",
	});
	assertEquals(rank.tier, "shared_entity");
	assertEquals(rank.reason, "Monarch Labs · business +1");
	// Recency is the newest instant across ALL evidence, not the winning tier's.
	assertEquals(rank.lastInteractionAt, "2026-07-16T00:00:00Z");
});

Deno.test("mutual follow outranks a one-way follow, which outranks collaboration, which outranks a thread", () => {
	const mutual = deriveContactRank({
		...emptyEvidence(),
		followsThem: "2026-07-01T00:00:00Z",
		followsMe: "2026-07-02T00:00:00Z",
		collaborations: [{ projectId: "p", title: "X", completed: true, at: null }],
		lastMessageAt: "2026-07-03T00:00:00Z",
	});
	assertEquals(mutual.tier, "mutual_follow");
	assertEquals(mutual.reason, "You follow each other");

	const oneWay = deriveContactRank({
		...emptyEvidence(),
		followsThem: "2026-07-01T00:00:00Z",
		collaborations: [{ projectId: "p", title: "X", completed: true, at: null }],
	});
	assertEquals(oneWay.tier, "follows");

	const collab = deriveContactRank({
		...emptyEvidence(),
		collaborations: [
			{ projectId: "p1", title: "Ongoing", completed: false, at: "2026-07-15T00:00:00Z" },
			{ projectId: "p2", title: "Finished", completed: true, at: "2026-06-01T00:00:00Z" },
		],
		lastMessageAt: "2026-07-16T00:00:00Z",
	});
	assertEquals(collab.tier, "collaborated");
	// The completed engagement leads the reason even when an ongoing one is more recent.
	assertEquals(collab.reason, "Worked together · Finished +1");

	const conversed = deriveContactRank({
		...emptyEvidence(),
		lastMessageAt: "2026-07-16T00:00:00Z",
	});
	assertEquals(conversed.tier, "conversed");
});
// #endregion

// #region Ordering
Deno.test("sorting is tier first, then most recent interaction, then name; a blank instant sorts last within its tier", () => {
	const list = [
		ranked("zed", "none", null),
		ranked("old-team", "shared_entity", "2026-01-01T00:00:00Z"),
		ranked("blank-team", "shared_entity", null, "Aaron"),
		ranked("new-team", "shared_entity", "2026-07-01T00:00:00Z"),
		ranked("collab", "collaborated", "2026-07-16T00:00:00Z"),
		ranked("mutual", "mutual_follow", null),
	];
	assertEquals(sortRankedContacts(list).map((c) => c.id), [
		"new-team",
		"old-team",
		"blank-team",
		"mutual",
		"collab",
		"zed",
	]);
	// The comparator is a total order: symmetric and consistent with itself.
	for (const a of list) {
		for (const b of list) {
			assertEquals(Math.sign(compareRankedContacts(a, b)), -Math.sign(compareRankedContacts(b, a)));
		}
	}
});

Deno.test("grouping omits empty tiers and keeps TIER_ORDER", () => {
	const groups = groupContactsByTier([
		ranked("c", "conversed", null),
		ranked("s", "shared_entity", null),
		ranked("f", "follows", null),
	]);
	assertEquals(groups.map((g) => g.tier), ["shared_entity", "follows", "conversed"]);
	assertEquals(groups[0].label, "Your teams & businesses");
});
// #endregion

// #region Search + labels
Deno.test("the search predicate matches name or handle, ignores case and a leading @", () => {
	const c = { name: "Ivy Chen", handle: "ivy" };
	assert(contactMatches(c, "ivy"));
	assert(contactMatches(c, "@IVY"));
	assert(contactMatches(c, "chen"));
	assert(contactMatches(c, ""));
	assert(!contactMatches(c, "mara"));
	assert(!contactMatches({ name: "Nobody", handle: null }, "ivy"));
});

Deno.test("the recency label is coarse and pinned to the clock it is given", () => {
	assertEquals(interactionLabel(null, NOW), null);
	assertEquals(interactionLabel("not a date", NOW), null);
	assertEquals(interactionLabel(new Date(NOW - 10_000).toISOString(), NOW), "Just now");
	assertEquals(interactionLabel(new Date(NOW - 5 * 60_000).toISOString(), NOW), "5m");
	assertEquals(interactionLabel(new Date(NOW - 3 * 3_600_000).toISOString(), NOW), "3h");
	assertEquals(interactionLabel(new Date(NOW - 2 * 86_400_000).toISOString(), NOW), "2d");
	assertEquals(interactionLabel(new Date(NOW - 20 * 86_400_000).toISOString(), NOW), "2w");
	assertEquals(interactionLabel("2026-02-03T00:00:00Z", NOW), "Feb 3");
	// A future instant (clock skew) is not negative time.
	assertEquals(interactionLabel(new Date(NOW + 60_000).toISOString(), NOW), "Just now");
});
// #endregion

// #region Writes
Deno.test("a create needs at least one contact and trims its optional text", () => {
	assert(!CreateConversationSchema.safeParse({ contactIds: [] }).success);
	const parsed = CreateConversationSchema.parse({
		contactIds: ["mara"],
		groupName: "  Design crew  ",
		message: "  hi  ",
	});
	assertEquals(parsed.groupName, "Design crew");
	assertEquals(parsed.message, "hi");
});

Deno.test("contact ids are de-duplicated in order, blanks dropped", () => {
	assertEquals(uniqueContactIds(["a", " b ", "a", "", "c", "b"]), ["a", "b", "c"]);
});
// #endregion
