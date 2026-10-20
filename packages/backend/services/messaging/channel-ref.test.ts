import { assert, assertEquals } from "@std/assert";
import { fixtureChannelConversationId, parseFixtureChannelConversationId } from "./channel-ref.ts";
import {
	findConversationDetail,
	findConversations,
	findConversationSummary,
} from "./conversation-fixtures.ts";
import { findConversationMessagePage } from "./messages-fixtures.ts";

Deno.test("a fixture channel address round-trips, and nothing else parses as one", () => {
	const ref = { kind: "team" as const, handle: "north-loop", slug: "delivery-sync" };
	const id = fixtureChannelConversationId(ref);
	assertEquals(id, "ch-team.north-loop.delivery-sync");
	assertEquals(parseFixtureChannelConversationId(id), ref);
	for (
		const other of ["dm-mara", "ch-team.north", "ch-agency.x.y", "ch-team..general", "grp-new-1"]
	) {
		assertEquals(parseFixtureChannelConversationId(other), null, other);
	}
});

Deno.test("the fixture corpus renders a channel it is handed, and never lists one in the inbox", () => {
	const id = fixtureChannelConversationId({
		kind: "business",
		handle: "heliafinance",
		slug: "general",
	});
	const summary = findConversationSummary(id);
	assert(summary);
	assertEquals([summary.kind, summary.relation, summary.title], [
		"entity_channel",
		"business",
		"#general",
	]);
	const detail = findConversationDetail(id);
	assertEquals(detail?.canAddMembers, false);
	assertEquals(detail?.sub, "4 members");
	const page = findConversationMessagePage({ conversationId: id });
	assert(page && page.messages.length > 0, "the channel has a feed to replay");
	assert(!findConversations({}).conversations.some((c) => c.kind === "entity_channel"));
});
