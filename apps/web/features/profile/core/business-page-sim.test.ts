import { assertEquals, assertStrictEquals } from "@std/assert";
import { ProfileHiddenReason, type ProfileView } from "@projective/types/profile";
import { applyBusinessPageSim, parseBusinessPageSim } from "./business-page-sim.ts";

/**
 * business-page-sim_test — the Dev Context Switcher's business page state (Decision #244): only a
 * recognised value simulates anything, only a business is touched, `missing` is the outsider's 404,
 * and a reason keeps the viewer's real console doors.
 */

// #region Fixtures
const business = {
	handle: "@atlaslabs",
	name: "Atlas Labs",
	kind: "business",
	workspace: {
		hiddenReason: null,
		consoleHref: "/businesses/atlaslabs",
		settingsHref: null,
	},
} as ProfileView;
// #endregion

Deno.test("parseBusinessPageSim reads the four states and nothing else", () => {
	assertStrictEquals(parseBusinessPageSim("draft"), "draft");
	assertStrictEquals(parseBusinessPageSim("archived"), "archived");
	assertStrictEquals(parseBusinessPageSim("invite_only"), "invite_only");
	assertStrictEquals(parseBusinessPageSim("missing"), "missing");
	assertStrictEquals(parseBusinessPageSim("unlisted"), null);
	assertStrictEquals(parseBusinessPageSim(""), null);
	assertStrictEquals(parseBusinessPageSim(undefined), null);
	// The codec's own list keeps pace with the SSOT enum.
	for (const reason of ProfileHiddenReason.options) {
		assertStrictEquals(parseBusinessPageSim(reason), reason);
	}
});

Deno.test("applyBusinessPageSim lays a reason over a business and keeps its doors", () => {
	const shown = applyBusinessPageSim(business, "invite_only");
	assertEquals(shown?.workspace, {
		hiddenReason: "invite_only",
		consoleHref: "/businesses/atlaslabs",
		settingsHref: null,
	});
	// A read that carried no facts still gets the notice, with no doors.
	const bare = applyBusinessPageSim({ ...business, workspace: undefined }, "draft");
	assertEquals(bare?.workspace, { hiddenReason: "draft", consoleHref: null, settingsHref: null });
});

Deno.test("applyBusinessPageSim: missing is the outsider's 404; other kinds and no sim pass through", () => {
	assertStrictEquals(applyBusinessPageSim(business, "missing"), null);
	assertStrictEquals(applyBusinessPageSim(business, null), business);
	const team = { ...business, kind: "team", workspace: undefined } as ProfileView;
	assertStrictEquals(applyBusinessPageSim(team, "missing"), team);
	assertStrictEquals(applyBusinessPageSim(team, "draft"), team);
	assertStrictEquals(applyBusinessPageSim(null, "draft"), null);
});
