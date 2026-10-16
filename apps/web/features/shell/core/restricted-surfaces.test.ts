import { assert, assertEquals, assertFalse } from "@std/assert";
import { noticeMessage, readNoticeParam } from "@features/projects/core/project-notice.ts";
import {
	canUseTeams,
	isRestrictedPath,
	isTeamsPath,
	TEAMS_PERSONA_FALLBACK,
} from "./restricted-surfaces.ts";

Deno.test("isRestrictedPath — money, selling and workspace surfaces, at any depth", () => {
	for (
		const path of [
			"/wallet",
			"/wallet/payouts",
			"/businesses",
			"/businesses/create",
			"/basket",
			"/checkout/payment",
			"/catalogue/svc-1",
			"/services/new",
			"/products/new",
			"/teams/create",
			"/analytics",
			"/become-partner",
			"/settings/verification",
			"/settings/billing",
		]
	) assert(isRestrictedPath(path), path);
});

Deno.test("isRestrictedPath — a shared prefix is not a match, and personal surfaces stay", () => {
	for (
		const path of [
			"/walletish",
			"/home",
			"/projects",
			"/projects/prj-abc/board",
			"/explore",
			"/messages",
			"/calendar",
			"/files",
			"/settings/account",
		]
	) assertEquals(isRestrictedPath(path), false, path);
});

// #region Teams persona (Decision #228 (A))
const FREELANCER = {
	contextType: "personal",
	isFreelancer: true,
	isOperator: false,
	restricted: false,
} as const;

Deno.test("canUseTeams — a freelancer may, a client and an operator-mode freelancer may not", () => {
	assert(canUseTeams(FREELANCER));
	assertFalse(canUseTeams({ ...FREELANCER, isFreelancer: false }));
	assertFalse(canUseTeams({ ...FREELANCER, isOperator: true }));
});

Deno.test("canUseTeams — a member acting as a team may, even in operator mode", () => {
	assert(canUseTeams({ ...FREELANCER, contextType: "team", isOperator: true }));
	assert(canUseTeams({ ...FREELANCER, contextType: "team", isFreelancer: false }));
});

Deno.test("canUseTeams — a minor never may; the age rule still wins", () => {
	assertFalse(canUseTeams({ ...FREELANCER, restricted: true }));
	assertFalse(canUseTeams({ ...FREELANCER, contextType: "team", restricted: true }));
});

Deno.test("canUseTeams — a business or enterprise context is not a team", () => {
	assertFalse(canUseTeams({ ...FREELANCER, contextType: "business", isFreelancer: false }));
	assertFalse(canUseTeams({ ...FREELANCER, contextType: "enterprise", isFreelancer: false }));
});

Deno.test("isTeamsPath — /teams at any depth, never a shared prefix", () => {
	for (const path of ["/teams", "/teams/create", "/teams/acme/members"]) {
		assert(isTeamsPath(path), path);
	}
	for (const path of ["/teamsx", "/team", "/businesses", "/home"]) {
		assertFalse(isTeamsPath(path), path);
	}
});

Deno.test("the persona fallback is home, flashing a notice the home page can say", () => {
	assertEquals(TEAMS_PERSONA_FALLBACK, "/home?notice=teams-freelancer");
	assertEquals(
		noticeMessage(readNoticeParam("?notice=teams-freelancer")),
		"Teams are for freelancer accounts",
	);
});
// #endregion
