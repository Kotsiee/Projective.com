/// <reference lib="dom" />
import { assertStrictEquals } from "@std/assert";
import type { ProposalAllowanceStatus } from "@projective/types/finance";
import {
	type AllowanceSnapshot,
	disclosureLine,
	meterLine,
	meterTooltip,
	msUntil,
	refillLine,
	showsUpgrade,
	simulateAllowance,
} from "./allowance-model.ts";

/**
 * The allowance's presentation rules. What matters is that every surface reads one status the same way:
 * the meter's fractions, a countdown measured on the SERVER's clock (a laptop five minutes fast must not
 * show the token five minutes early), the upgrade link's threshold, and the Dev Context Switcher's
 * simulated positions keeping the viewer's own plan while moving only the metered facts.
 */

const SERVER_NOW = Date.parse("2026-10-07T12:00:00.000Z");

const STATUS: ProposalAllowanceStatus = {
	subjectType: "user",
	subjectId: "950d68d1-8777-4bbe-ae59-3343e3e7f858",
	weeklyGranted: 70,
	weeklyConsumed: 32,
	weeklyRemaining: 38,
	weeklyResetsAt: "2026-10-12T00:00:00.000Z",
	bufferUnits: 9,
	bufferCap: 12,
	bufferDrip: 3,
	bufferWindowHours: 10,
	nextBufferRefillAt: "2026-10-07T14:45:00.000Z",
	canApply: true,
	enforced: false,
	planCode: "individual_free",
	planLabel: "Free",
	planTier: "free",
	upgrade: { planLabel: "Individual Pro", weeklyUnits: 150 },
	standingLevel: 3,
	standingBonus: 20,
	teamMemberCount: null,
	canBindSeat: null,
	serverNow: new Date(SERVER_NOW).toISOString(),
};

Deno.test("the meter reads weekly left of granted, then buffer of cap", () => {
	assertStrictEquals(meterLine(STATUS), "Proposals: 38/70 weekly · 9/12 ready");
	assertStrictEquals(disclosureLine(STATUS), "1 proposal token · 9 ready");
});

Deno.test("the tooltip names the drip and the earned bonus — and no bonus at rung 1", () => {
	assertStrictEquals(
		meterTooltip(STATUS),
		"Replenishes 3 tokens every 10 hours. Earned Standing L3 grants +20 weekly proposals.",
	);
	assertStrictEquals(
		meterTooltip({ ...STATUS, standingLevel: 1, standingBonus: 0 }),
		"Replenishes 3 tokens every 10 hours. Earned Standing adds weekly proposals as you climb.",
	);
});

Deno.test("a countdown is measured on the server's clock, whatever the client's says", () => {
	// The client's clock is five minutes FAST: at its 12:05 it is 12:00 on the server.
	const fast: AllowanceSnapshot = { status: STATUS, receivedAt: SERVER_NOW + 5 * 60_000 };
	assertStrictEquals(
		msUntil(STATUS.nextBufferRefillAt!, fast, fast.receivedAt),
		(2 * 60 + 45) * 60_000,
	);
	assertStrictEquals(refillLine(fast, fast.receivedAt), "Next token in 2h 45m");
});

Deno.test("a full buffer has no refill line, and a passed instant says it is arriving", () => {
	const snap: AllowanceSnapshot = { status: STATUS, receivedAt: SERVER_NOW };
	assertStrictEquals(
		refillLine({ ...snap, status: { ...STATUS, nextBufferRefillAt: null } }, SERVER_NOW),
		null,
	);
	assertStrictEquals(refillLine(snap, SERVER_NOW + 3 * 3_600_000), "Next token arriving now");
});

Deno.test("the upgrade link shows at ≤ 5 weekly or an empty buffer, and never on a paid plan", () => {
	assertStrictEquals(showsUpgrade(STATUS), false);
	assertStrictEquals(showsUpgrade({ ...STATUS, weeklyRemaining: 5 }), true);
	assertStrictEquals(showsUpgrade({ ...STATUS, bufferUnits: 0 }), true);
	assertStrictEquals(showsUpgrade({ ...STATUS, bufferUnits: 0, upgrade: null }), false);
});

Deno.test("simulated positions keep the viewer's plan and move only the metered facts", () => {
	assertStrictEquals(simulateAllowance("auto", STATUS, SERVER_NOW), STATUS);

	const paced = simulateAllowance("paced", STATUS, SERVER_NOW)!;
	assertStrictEquals(paced.planCode, STATUS.planCode);
	assertStrictEquals(paced.bufferUnits, 0);
	assertStrictEquals(paced.canApply, false);
	assertStrictEquals(paced.blockReason, "buffer_exhausted");
	assertStrictEquals(paced.nextBufferRefillAt, "2026-10-07T16:12:30.000Z");

	const soft = simulateAllowance("paced_soft", STATUS, SERVER_NOW)!;
	assertStrictEquals(soft.canApply, true);
	assertStrictEquals(soft.enforced, false);

	const week = simulateAllowance("weekly", STATUS, SERVER_NOW)!;
	assertStrictEquals(week.weeklyRemaining, 0);
	assertStrictEquals(week.blockReason, "weekly_exhausted");

	const team = simulateAllowance("team_small", null, SERVER_NOW)!;
	assertStrictEquals(team.teamMemberCount, 1);
	assertStrictEquals(team.canApply, false);
});
