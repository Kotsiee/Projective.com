import { assert, assertEquals, assertFalse } from "@std/assert";
import {
	parsePayoutOverride,
	PAYOUT_NOT_READY_REFUSAL,
	PAYOUT_SETUP_HREF,
	readPayoutGateDetails,
} from "@projective/types/finance";
import { isPayoutNotReady, payoutNotReadyRefusal } from "./payout-gate.ts";

const SELF = {
	code: "PK403",
	message:
		"payout_not_ready: verify your identity and add a payout account before you take on paid work or join a team",
	hint: "self",
	details: null,
};

Deno.test("only the earning gate's PK403 is a payout-not-ready refusal", () => {
	assert(isPayoutNotReady(SELF));
	assert(isPayoutNotReady({ ...SELF, message: `ERROR:  ${SELF.message}` }));
	assertFalse(isPayoutNotReady({ code: "PK403", message: "verification: verify your identity" }));
	assertFalse(isPayoutNotReady({ code: "PM403", message: SELF.message }));
	assertFalse(isPayoutNotReady(null));
});

Deno.test("the caller's own refusal links to Settings → Verification", () => {
	const refusal = payoutNotReadyRefusal(SELF);
	assertEquals(refusal.status, 403);
	assertEquals(
		refusal.message,
		"Verify your identity and add a payout account before you take on paid work or join a team.",
	);
	assertEquals(refusal.details, {
		reason: "payout_not_ready",
		actor: "self",
		href: PAYOUT_SETUP_HREF,
		members: null,
	});
	assertEquals(readPayoutGateDetails(refusal.details), refusal.details);
});

Deno.test("someone else's refusal carries no link, and a lead sees the team's handles", () => {
	const other = payoutNotReadyRefusal({
		...SELF,
		hint: "other",
		message: "payout_not_ready: this freelancer needs to verify",
	});
	assertEquals(other.details.actor, "other");
	assertEquals(other.details.href, null);

	const team = payoutNotReadyRefusal({ ...SELF, hint: "team", details: "@ada, @lin" });
	assertEquals(team.details.actor, "team");
	assertEquals(team.details.href, null);
	assertEquals(team.details.members, "@ada, @lin");

	const notLead = payoutNotReadyRefusal({ ...SELF, hint: "team", details: "" });
	assertEquals(notLead.details.members, null);
});

Deno.test("an unknown hint never offers the fix link, and an empty message falls back", () => {
	const refusal = payoutNotReadyRefusal({
		code: "PK403",
		message: "payout_not_ready:",
		hint: "who",
	});
	assertEquals(refusal.details.actor, "other");
	assertEquals(refusal.details.href, null);
	assertEquals(refusal.message, PAYOUT_NOT_READY_REFUSAL);
});

Deno.test("other refusals' details are not read as the gate's", () => {
	assertEquals(readPayoutGateDetails({ reason: "age_restricted" }), null);
	assertEquals(readPayoutGateDetails(undefined), null);
});

Deno.test("the dev override reads only not_ready", () => {
	assertEquals(parsePayoutOverride(" not_ready "), "not_ready");
	assertEquals(parsePayoutOverride("ready"), null);
	assertEquals(parsePayoutOverride("maybe"), null);
	assertEquals(parsePayoutOverride(undefined), null);
});
