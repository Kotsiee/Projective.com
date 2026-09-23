import { assert, assertEquals } from "@std/assert";
import { conditionalChannelGroups } from "@projective/types/projects";
import { findProjectDetail } from "./detail-fixtures.ts";
import { ACTOR_HANDLE, allProjects } from "./fixtures.ts";

/**
 * The stub corpus against the Teams / Private Messages rule. With `PROJECTS_BACKEND_LIVE` off these
 * fixtures ARE the lane, so every state the rule distinguishes has to be reachable from them, and none
 * of them may show a group the rule forbids.
 */

function groupsOf(slug: string) {
	const detail = findProjectDetail(slug);
	assert(detail, `fixture ${slug} no longer resolves`);
	return conditionalChannelGroups(detail.channels);
}

const shown = (slug: string) => {
	const { teams, dms } = groupsOf(slug);
	return { teams: teams.length > 0, dms: dms.length > 0 };
};

Deno.test("a draft nobody has been hired onto draws neither group", () => {
	assertEquals(shown("prj-t22dcmq5fr"), { teams: false, dms: false });
	assertEquals(shown("prj-tm2bjk9mdq"), { teams: false, dms: false });
});

Deno.test("a live engagement the viewer only watches from a buying organisation draws neither", () => {
	assertEquals(shown("prj-mvztqq7ftf"), { teams: false, dms: false });
});

Deno.test("a member of the hired team sees Teams without a private thread of their own", () => {
	assertEquals(shown("prj-64vn8qwog8"), { teams: true, dms: false });
});

Deno.test("the seat holding the client relationship on a hired team sees both groups", () => {
	assertEquals(shown("prj-eangynf67d"), { teams: true, dms: true });
});

Deno.test("a client with a project conversation sees Private Messages and no Teams", () => {
	assertEquals(shown("prj-8mzxqqn6w8"), { teams: false, dms: true });
});

Deno.test("only a team-scope engagement ever carries a Teams group", () => {
	for (const row of allProjects()) {
		if (row.scopeType === "team") continue;
		assertEquals(groupsOf(row.slug).teams, [], `${row.slug} (${row.scopeType}) drew a Teams group`);
	}
});

Deno.test("every private thread is with somebody on the roster, and never with the viewer", () => {
	for (const row of allProjects()) {
		const detail = findProjectDetail(row.slug);
		assert(detail);
		const roster = new Set(detail.members.map((m) => m.party.handle));
		for (const thread of detail.channels.dms) {
			assert(roster.has(thread.party.handle), `${row.slug}: ${thread.chatId} is not a member`);
			assert(thread.party.handle !== ACTOR_HANDLE, `${row.slug}: the viewer messages themselves`);
		}
	}
});
