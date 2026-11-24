import { assertEquals } from "@std/assert";
import { type DmChannel, dmChannelLabel, DmChannelSchema } from "./detail.ts";

/**
 * dm-channel-label_test — how a Private Messages row and its room header name a thread (PROJECTS
 * CH3; Decision #508 (f)): a pair DM by its counterpart, a group by its own name or its members.
 */

const person = (name: string) => ({ name, avatar: null, handle: null });
const pair: DmChannel = {
	chatId: "cht-23456789ab",
	party: person("Fern Hill"),
	unread: false,
	hasProjectContext: true,
};

Deno.test("a pair DM is named by its counterpart", () => {
	assertEquals(dmChannelLabel(pair), "Fern Hill");
});

Deno.test("a named group is named by its own name", () => {
	assertEquals(
		dmChannelLabel({
			...pair,
			group: { title: "Launch crew", members: [person("Fern Hill"), person("Cal Ray")] },
		}),
		"Launch crew",
	);
});

Deno.test("an unnamed group is named by its members' first names", () => {
	const g = (names: string[]) => ({ ...pair, group: { title: null, members: names.map(person) } });
	assertEquals(dmChannelLabel(g(["Fern Hill"])), "Fern");
	assertEquals(dmChannelLabel(g(["Fern Hill", "Cal Ray"])), "Fern and Cal");
	assertEquals(dmChannelLabel(g(["Fern Hill", "Cal Ray", "Ada Lo"])), "Fern, Cal and Ada");
	assertEquals(
		dmChannelLabel(g(["Fern Hill", "Cal Ray", "Ada Lo", "Bo Ng", "Jo"])),
		"Fern, Cal and 3 others",
	);
});

Deno.test("the row schema accepts a pair without group facts and a group with them", () => {
	DmChannelSchema.parse(pair);
	DmChannelSchema.parse({ ...pair, group: { title: null, members: [person("Cal")] } });
	assertEquals(
		DmChannelSchema.safeParse({ ...pair, group: { title: null, members: [] } }).success,
		false,
	);
});
