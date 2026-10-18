import { assertEquals, assertNotEquals, assertStrictEquals } from "@std/assert";
import { ProfileHiddenReason, type ProfileView } from "@projective/types/profile";
import { applyTeamPageSim, parseTeamPageSim, TEAM_PAGE_SIM_COOKIE } from "./team-page-sim.ts";
import { BUSINESS_PAGE_SIM_COOKIE } from "./business-page-sim.ts";
import { memberNoticeFor } from "./profile-model.ts";

/**
 * team-page-sim_test — the Dev Context Switcher's team page state (Teams P1): only a recognised value
 * simulates anything, only a team is touched, `missing` is the outsider's 404, and a reason keeps the
 * viewer's real console doors — so a simulated draft reads the member notice, and keeps the Settings
 * door the notice links (a team's Settings publishes, Teams C6).
 */

// #region Fixtures
const team = {
	handle: "@northloop",
	name: "North Loop",
	kind: "team",
	visibility: "public",
	workspace: {
		hiddenReason: null,
		consoleHref: "/teams/northloop",
		settingsHref: "/teams/northloop/settings",
	},
} as ProfileView;
// #endregion

Deno.test("parseTeamPageSim reads the four states and nothing else, on its own cookie", () => {
	for (const reason of ProfileHiddenReason.options) {
		assertStrictEquals(parseTeamPageSim(reason), reason);
	}
	assertStrictEquals(parseTeamPageSim("missing"), "missing");
	assertStrictEquals(parseTeamPageSim("unlisted"), null);
	assertStrictEquals(parseTeamPageSim(undefined), null);
	// Its own cookie, so the two axes are set independently.
	assertNotEquals<string>(TEAM_PAGE_SIM_COOKIE, BUSINESS_PAGE_SIM_COOKIE);
});

Deno.test("applyTeamPageSim lays a reason over a team, keeps its doors, and the notice follows", () => {
	const shown = applyTeamPageSim(team, "draft");
	assertEquals(shown?.workspace, {
		hiddenReason: "draft",
		consoleHref: "/teams/northloop",
		settingsHref: "/teams/northloop/settings",
	});
	const text = "North Loop is a draft. Only members can see this until the team is published.";
	// The simulated draft keeps the door the notice links: Settings, which publishes (Teams C6).
	assertEquals(memberNoticeFor(shown!), { text, settingsHref: "/teams/northloop/settings" });
	const bare = applyTeamPageSim({ ...team, workspace: undefined }, "archived");
	assertEquals(bare?.workspace, {
		hiddenReason: "archived",
		consoleHref: null,
		settingsHref: null,
	});
});

Deno.test("applyTeamPageSim: missing is the outsider's 404; other kinds and no sim pass through", () => {
	assertStrictEquals(applyTeamPageSim(team, "missing"), null);
	assertStrictEquals(applyTeamPageSim(team, null), team);
	const business = { ...team, kind: "business" } as ProfileView;
	assertStrictEquals(applyTeamPageSim(business, "missing"), business);
	assertStrictEquals(applyTeamPageSim(business, "draft"), business);
	assertStrictEquals(applyTeamPageSim(null, "draft"), null);
});
