import { assert, assertEquals, assertStrictEquals } from "@std/assert";
import type { ProjectChannel, ProjectChannels } from "../types/projects-types.ts";
import { detailWithChatReads, withChatReads } from "./chat-read-marks.ts";

/**
 * chat-read-marks_test — the tree's read overlay (PROJECTS CH3). The chat on screen posts its read
 * mark after paint, so the request that drew the tree could not know it had been read; this tab's
 * marks clear the dot of exactly the row the chat was opened at, and nothing else.
 */

const room = (id: string, unread = true): ProjectChannel => ({
	id,
	chatId: id,
	name: id,
	kind: "general",
	unread,
});

function tree(): ProjectChannels {
	// Every group the tree draws, the business rooms (PROJECTS CH2) included, cast so the fixture reads
	// the same whichever groups the schema carries.
	return {
		business: [],
		general: [room("r-general")],
		stages: [
			{
				id: "r-s1",
				slug: "stg-discovery1",
				stageId: "s1",
				name: "Discovery",
				order: 0,
				status: "active",
				channel: { ...room("r-s1"), kind: "stage" },
			},
			{
				id: "r-s2",
				slug: "stg-delivery01",
				stageId: "s2",
				name: "Delivery",
				order: 1,
				status: "active",
				channel: { ...room("r-s2"), kind: "stage" },
			},
		],
		teams: [{
			teamId: "t1",
			teamName: "Northwind",
			avatar: null,
			assignedStages: ["Discovery"],
			channels: [{ ...room("r-team"), kind: "team" }],
		}],
		dms: [
			{
				chatId: "cht-23456789ab",
				party: { name: "Fern", avatar: null, handle: null },
				unread: true,
				hasProjectContext: true,
			},
			{
				chatId: "cht-bcdefghjkm",
				party: { name: "Cal", avatar: null, handle: null },
				unread: true,
				hasProjectContext: true,
			},
		],
	} as ProjectChannels;
}

const unreadOf = (c: ProjectChannels) => ({
	general: c.general.map((r) => r.unread),
	stages: c.stages.map((s) => s.channel.unread),
	teams: c.teams.flatMap((t) => t.channels.map((r) => r.unread)),
	dms: c.dms.map((d) => d.unread),
});

Deno.test("no marks: the same channels back, untouched", () => {
	const channels = tree();
	assertStrictEquals(withChatReads(channels, {}), channels);
});

Deno.test("a stage opened at its stg- address clears its own dot only", () => {
	const out = withChatReads(tree(), { "stg-discovery1": true });
	assertEquals(unreadOf(out), {
		general: [true],
		stages: [false, true],
		teams: [true],
		dms: [true, true],
	});
});

Deno.test("the discussion address clears the project-wide room; a room id clears its room", () => {
	assertEquals(unreadOf(withChatReads(tree(), { discussion: true })).general, [false]);
	assertEquals(unreadOf(withChatReads(tree(), { "r-team": true })).teams, [false]);
	assertEquals(unreadOf(withChatReads(tree(), { "r-s2": true })).stages, [true, false]);
});

Deno.test("a project DM opened at its cht- ref clears that row only", () => {
	assertEquals(unreadOf(withChatReads(tree(), { "cht-bcdefghjkm": true })).dms, [true, false]);
});

Deno.test("detailWithChatReads keeps the detail object when nothing was marked", () => {
	const detail = { channels: tree() } as unknown as Parameters<typeof detailWithChatReads>[0];
	assertStrictEquals(detailWithChatReads(detail, {}), detail);
	const marked = detailWithChatReads(detail, { "stg-discovery1": true });
	assert(marked !== detail);
	assertEquals(marked.channels.stages[0].channel.unread, false);
});
