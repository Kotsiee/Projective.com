import { assertEquals, assertStrictEquals } from "@std/assert";
import {
	allowanceBlockReason,
	allowanceNotice,
	allowanceNoticeText,
	formatCountdown,
	formatCountdownShort,
	nextBufferRefillAt,
	type ProposalAllowanceRow,
	refusesApplication,
	resolveProposalAllowance,
	TEAM_NOT_ACTIVE_NOTICE,
} from "./allowance.ts";

/**
 * The proposal allowance's resolution rules, tested where they are defined. The cases are the ones a
 * mistake would cost real people: an over-cap meter refusing while enforcement is OFF (the fail-open
 * switch silently flipped), an eligibility rule NOT refusing because the switch is off, the weekly
 * quota losing to the buffer in the explanation, and a countdown that drifts or goes negative.
 */

const NOW = "2026-10-07T12:00:00.000Z";

function row(overrides: Partial<ProposalAllowanceRow> = {}): ProposalAllowanceRow {
	return {
		subject_type: "user",
		subject_id: "950d68d1-8777-4bbe-ae59-3343e3e7f858",
		period_end: "2026-10-12T00:00:00.000Z",
		granted_units: 50,
		consumed_units: 12,
		standing_bonus_units: 0,
		buffer_units: 12,
		buffer_cap: 12,
		buffer_refreshed_at: "2026-10-07T06:00:00.000Z",
		buffer_window_hours: 10,
		buffer_drip: 3,
		plan_code: "individual_free",
		plan_label: "Pro",
		plan_tier: "free",
		plan_audience: "individual",
		upgrade_plan_label: "Pro",
		upgrade_weekly_units: 150,
		standing_level: 1,
		enforced: false,
		team_status: null,
		team_member_count: null,
		can_bind_seat: null,
		server_now: NOW,
		...overrides,
	};
}

Deno.test("a healthy allowance applies, with no reason and no refill while the buffer is full", () => {
	const status = resolveProposalAllowance(row());
	assertStrictEquals(status.canApply, true);
	assertStrictEquals(status.blockReason, undefined);
	assertStrictEquals(status.weeklyRemaining, 38);
	assertStrictEquals(status.nextBufferRefillAt, null);
	assertEquals(status.upgrade, { planLabel: "Individual Pro", weeklyUnits: 150 });
});

Deno.test("the next refill is one window after the drip clock, only while below the cap", () => {
	assertStrictEquals(
		nextBufferRefillAt(9, 12, "2026-10-07T06:00:00.000Z", 10),
		"2026-10-07T16:00:00.000Z",
	);
	assertStrictEquals(nextBufferRefillAt(12, 12, "2026-10-07T06:00:00.000Z", 10), null);
	assertStrictEquals(nextBufferRefillAt(0, 0, "2026-10-07T06:00:00.000Z", 10), null);
});

Deno.test("an empty buffer is reported but does NOT refuse while enforcement is off", () => {
	const status = resolveProposalAllowance(row({ buffer_units: 0 }));
	assertStrictEquals(status.blockReason, "buffer_exhausted");
	assertStrictEquals(status.canApply, true);
});

Deno.test("an empty buffer refuses once enforcement is on", () => {
	const status = resolveProposalAllowance(row({ buffer_units: 0, enforced: true }));
	assertStrictEquals(status.canApply, false);
});

Deno.test("eligibility rules refuse regardless of the enforcement switch", () => {
	assertStrictEquals(refusesApplication("team_too_small", false), true);
	assertStrictEquals(refusesApplication("team_not_active", false), true);
	assertStrictEquals(refusesApplication("missing_permission", false), true);
	assertStrictEquals(refusesApplication("weekly_exhausted", false), false);
	const team = resolveProposalAllowance(
		row({ subject_type: "team", team_status: "active", team_member_count: 1, can_bind_seat: true }),
	);
	assertStrictEquals(team.blockReason, "team_too_small");
	assertStrictEquals(team.canApply, false);
});

Deno.test("a draft or archived team is refused as team_not_active, even unenforced", () => {
	for (const status of ["draft", "archived"] as const) {
		const team = resolveProposalAllowance(
			row({ subject_type: "team", team_status: status, team_member_count: 3, can_bind_seat: true }),
		);
		assertStrictEquals(team.blockReason, "team_not_active");
		assertStrictEquals(team.teamStatus, status);
		assertStrictEquals(team.canApply, false);
		assertStrictEquals(allowanceNotice(team)?.lead, TEAM_NOT_ACTIVE_NOTICE);
	}
});

Deno.test("the most fundamental reason wins in the database's order, then the week, then the buffer", () => {
	const base = { weeklyRemaining: 0, bufferUnits: 0, bufferCap: 12 };
	assertStrictEquals(
		allowanceBlockReason({ ...base, teamStatus: "draft", teamMemberCount: 1, canBindSeat: false }),
		"missing_permission",
	);
	assertStrictEquals(
		allowanceBlockReason({ ...base, teamStatus: "draft", teamMemberCount: 1, canBindSeat: true }),
		"team_not_active",
	);
	assertStrictEquals(
		allowanceBlockReason({ ...base, teamStatus: "active", teamMemberCount: 1, canBindSeat: true }),
		"team_too_small",
	);
	assertStrictEquals(
		allowanceBlockReason({ ...base, teamStatus: "active", teamMemberCount: 2, canBindSeat: true }),
		"weekly_exhausted",
	);
	assertStrictEquals(
		allowanceBlockReason({ ...base, teamStatus: null, teamMemberCount: null, canBindSeat: null }),
		"weekly_exhausted",
	);
});

Deno.test("the buffer notice carries a live countdown to the refill instant", () => {
	const status = resolveProposalAllowance(
		row({ buffer_units: 0, buffer_refreshed_at: "2026-10-07T06:12:30.000Z", enforced: true }),
	);
	const notice = allowanceNotice(status)!;
	assertStrictEquals(notice.blocking, true);
	assertStrictEquals(notice.countdownTo, "2026-10-07T16:12:30.000Z");
	assertStrictEquals(
		allowanceNoticeText(notice, Date.parse(NOW)),
		"Pacing limit reached (max 3 applications per 10 hours to prevent spam). Next proposal token available in 04h 12m 30s.",
	);
});

Deno.test("the weekly notice offers the catalogue's upgrade, and says so when it will not block", () => {
	const status = resolveProposalAllowance(row({ consumed_units: 50 }));
	const text = allowanceNoticeText(allowanceNotice(status)!, Date.parse(NOW));
	assertStrictEquals(
		text,
		"Weekly proposal allowance reached (50/50). Resets on Monday 00:00 UTC, or upgrade to Individual Pro for 150/week. Pacing isn't enforced yet, so an application will still go through.",
	);
});

Deno.test("a paid plan is offered no upgrade", () => {
	const status = resolveProposalAllowance(
		row({ plan_tier: "pro", upgrade_plan_label: null, upgrade_weekly_units: null }),
	);
	assertStrictEquals(status.upgrade, null);
});

Deno.test("countdowns are zero-padded, never negative, and the short form rounds up", () => {
	assertStrictEquals(formatCountdown(((4 * 60 + 12) * 60 + 30) * 1000), "04h 12m 30s");
	assertStrictEquals(formatCountdown(-5000), "00h 00m 00s");
	assertStrictEquals(formatCountdownShort((2 * 60 + 45) * 60_000), "2h 45m");
	assertStrictEquals(formatCountdownShort(20_000), "1m");
});
