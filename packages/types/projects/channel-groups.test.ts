import { assertEquals } from "@std/assert";
import { conditionalChannelGroups, type DmChannel, type TeamChannel } from "./detail.ts";

/**
 * conditionalChannelGroups — the one rule for when the Project Details lane draws its Teams and
 * Private Messages groups. An empty list is the instruction to omit the group, so each assertion here
 * is a group that either appears or does not.
 */

const party = (handle: string) => ({ name: handle, avatar: null, handle });

const team = (teamId: string, assignedStages: string[], channelCount = 0): TeamChannel => ({
	teamId,
	teamName: teamId,
	avatar: null,
	assignedStages,
	channels: Array.from({ length: channelCount }, (_, i) => ({
		id: `${teamId}-${i}`,
		chatId: `${teamId}-${i}`,
		name: `Room ${i}`,
		kind: "team" as const,
		sublabel: assignedStages[i] ?? null,
		unread: false,
	})),
});

const dm = (handle: string, hasProjectContext: boolean): DmChannel => ({
	chatId: `dm-${handle}`,
	party: party(handle),
	unread: false,
	hasProjectContext,
});

Deno.test("a clean engagement draws neither conditional group", () => {
	assertEquals(conditionalChannelGroups({ teams: [], business: [], dms: [] }), {
		teams: [],
		business: [],
		dms: [],
	});
});

Deno.test("threads that never carried project messages do not open the Private Messages group", () => {
	const groups = conditionalChannelGroups({
		teams: [],
		business: [],
		dms: [dm("ivy", false), dm("mara", false)],
	});
	assertEquals(groups.dms, []);
});

Deno.test("one project-scoped thread is enough to draw Private Messages, and only it is listed", () => {
	const groups = conditionalChannelGroups({
		teams: [],
		business: [],
		dms: [dm("ivy", false), dm("mara", true)],
	});
	assertEquals(groups.dms.map((d) => d.chatId), ["dm-mara"]);
});

Deno.test("a hired team is drawn even before anybody has opened its room", () => {
	const groups = conditionalChannelGroups({
		teams: [team("northwind", ["Discovery"])],
		business: [],
		dms: [],
	});
	assertEquals(groups.teams.map((t) => t.teamId), ["northwind"]);
	assertEquals(groups.teams[0].channels, []);
});

Deno.test("a team that holds no stage is not a hire and is not drawn", () => {
	const groups = conditionalChannelGroups({
		teams: [team("ghost", [], 1), team("northwind", ["Build"], 1)],
		business: [],
		dms: [],
	});
	assertEquals(groups.teams.map((t) => t.teamId), ["northwind"]);
});

Deno.test("the rule never mutates the projection it reads", () => {
	const channels = { teams: [team("ghost", [])], business: [], dms: [dm("ivy", false)] };
	conditionalChannelGroups(channels);
	assertEquals(channels.teams.length, 1);
	assertEquals(channels.dms.length, 1);
});

Deno.test("the business client's rooms are drawn as the server read them (CH2)", () => {
	const room = {
		id: "b1",
		chatId: "b1",
		name: "Discovery",
		kind: "business" as const,
		unread: false,
	};
	assertEquals(conditionalChannelGroups({ teams: [], business: [room], dms: [] }).business, [room]);
	assertEquals(conditionalChannelGroups({ teams: [], business: [], dms: [] }).business, []);
});
