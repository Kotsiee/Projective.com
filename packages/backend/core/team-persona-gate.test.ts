import { assert, assertEquals, assertFalse } from "@std/assert";
import { readTeamPersonaDetails, TEAM_PERSONA_REFUSAL } from "@projective/types/workspace";
import { isTeamPersonaRefused, teamPersonaRefusal } from "./team-persona-gate.ts";

const SELF_CLIENT = {
	code: "PK403",
	message: "persona_not_freelancer: Teams are for freelancer accounts",
	hint: "self",
	details: "client",
};

Deno.test("only the persona gate's PK403 is a persona refusal", () => {
	assert(isTeamPersonaRefused(SELF_CLIENT));
	assert(isTeamPersonaRefused({ ...SELF_CLIENT, message: `ERROR:  ${SELF_CLIENT.message}` }));
	assertFalse(
		isTeamPersonaRefused({ code: "PK403", message: "payout_not_ready: verify your identity" }),
	);
	assertFalse(isTeamPersonaRefused({ code: "PM403", message: SELF_CLIENT.message }));
	assertFalse(isTeamPersonaRefused(null));
});

Deno.test("the caller's own refusal carries the persona code and its side", () => {
	const refusal = teamPersonaRefusal(SELF_CLIENT);
	assertEquals(refusal.status, 403);
	assertEquals(refusal.message, TEAM_PERSONA_REFUSAL);
	assertEquals(refusal.details, { reason: "persona", actor: "self", persona: "client" });
	assertEquals(readTeamPersonaDetails(refusal.details), refusal.details);
});

Deno.test("an invitee in operator mode is `other` and `operator`", () => {
	const refusal = teamPersonaRefusal({
		code: "PK403",
		message: "persona_not_freelancer: only freelancer accounts can join a team",
		hint: "other",
		details: "operator",
	});
	assertEquals(refusal.message, "Only freelancer accounts can join a team.");
	assertEquals(refusal.details, { reason: "persona", actor: "other", persona: "operator" });
});

Deno.test("an unfamiliar hint or detail falls back rather than failing the parse", () => {
	const refusal = teamPersonaRefusal({
		code: "PK403",
		message: "persona_not_freelancer:",
		hint: null,
	});
	assertEquals(refusal.message, TEAM_PERSONA_REFUSAL);
	assertEquals(refusal.details, { reason: "persona", actor: "self", persona: "client" });
});
