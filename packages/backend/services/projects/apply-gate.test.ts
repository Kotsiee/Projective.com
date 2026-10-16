import { assertEquals, assertStrictEquals } from "@std/assert";
import {
	type ProposalAllowanceRow,
	resolveProposalAllowance,
	TEAM_NOT_ACTIVE_NOTICE,
} from "@projective/types/finance";
import { allowanceRefusal, teamNotActiveRefusal } from "./apply-gate.ts";

const NOW = "2026-10-16T12:00:00.000Z";
const TEAM = "a4c25501-0fdd-4abe-a575-ff478daad4fc";

function teamRow(overrides: Partial<ProposalAllowanceRow> = {}): ProposalAllowanceRow {
	return {
		subject_type: "team",
		subject_id: TEAM,
		period_end: "2026-10-19T00:00:00.000Z",
		granted_units: 50,
		consumed_units: 4,
		standing_bonus_units: 0,
		buffer_units: 12,
		buffer_cap: 12,
		buffer_refreshed_at: "2026-10-16T06:00:00.000Z",
		buffer_window_hours: 10,
		buffer_drip: 3,
		plan_code: "team_free",
		plan_label: "Free",
		plan_tier: "free",
		plan_audience: "team",
		upgrade_plan_label: "Pro Team",
		upgrade_weekly_units: 150,
		standing_level: 1,
		enforced: false,
		team_status: "active",
		team_member_count: 2,
		can_bind_seat: true,
		server_now: NOW,
		...overrides,
	};
}

function refusalFor(overrides: Partial<ProposalAllowanceRow>) {
	return allowanceRefusal<unknown>(resolveProposalAllowance(teamRow(overrides)));
}

// #region Pre-flight ordering
Deno.test("an eligible, published two-member team passes the pre-flight", () => {
	assertStrictEquals(refusalFor({}), null);
});

Deno.test("the pre-flight names the database's first refusal: permission, status, then size", () => {
	const cases: Array<[Partial<ProposalAllowanceRow>, string]> = [
		[{ can_bind_seat: false, team_status: "draft", team_member_count: 1 }, "missing_permission"],
		[{ team_status: "draft", team_member_count: 1 }, "team_not_active"],
		[{ team_status: "archived" }, "team_not_active"],
		[{ team_member_count: 1 }, "team_too_small"],
	];
	for (const [overrides, reason] of cases) {
		const refusal = refusalFor(overrides);
		assertStrictEquals(refusal?.status, 422, reason);
		assertEquals(refusal?.errors, { allowance: reason });
		assertStrictEquals(refusal?.details?.blockReason, reason);
	}
});

Deno.test("eligibility refuses while the allowance is meter-only; a spent meter does not", () => {
	assertStrictEquals(refusalFor({ enforced: false, team_status: "draft" })?.status, 422);
	assertStrictEquals(refusalFor({ enforced: false, buffer_units: 0 }), null);
	assertStrictEquals(refusalFor({ enforced: true, buffer_units: 0 })?.status, 422);
});

Deno.test("the team_not_active 422 carries the notice sentence and the meter figures", () => {
	const refusal = refusalFor({ team_status: "draft" });
	assertStrictEquals(refusal?.ok, false);
	assertStrictEquals(refusal?.message, TEAM_NOT_ACTIVE_NOTICE);
	assertEquals(refusal?.details, {
		blockReason: "team_not_active",
		weeklyRemaining: 46,
		weeklyGranted: 50,
		bufferUnits: 12,
		bufferCap: 12,
		nextBufferRefillAt: null,
		weeklyResetsAt: "2026-10-19T00:00:00.000Z",
	});
});
// #endregion

// #region Database backstop
Deno.test("the door's team_not_active refusal maps onto the pre-flight's envelope", () => {
	const refusal = teamNotActiveRefusal({
		code: "23514",
		message: "team_not_active: only a published team can apply — publish it in Settings",
	});
	assertEquals(refusal, {
		status: 422,
		message: TEAM_NOT_ACTIVE_NOTICE,
		errors: { allowance: "team_not_active" },
		details: { blockReason: "team_not_active" },
	});
});

Deno.test("other check violations are left to the handshake mapping", () => {
	assertStrictEquals(
		teamNotActiveRefusal({
			code: "23514",
			message: "Teams must have at least 2 members before applying to client projects.",
		}),
		null,
	);
	assertStrictEquals(teamNotActiveRefusal({ code: "42501", message: "team_not_active: x" }), null);
});
// #endregion
