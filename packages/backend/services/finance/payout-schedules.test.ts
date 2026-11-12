import { assertEquals } from "@std/assert";
import type { Payout, PayoutScheduleRun } from "@projective/types/finance";
import {
	nextPayoutRun,
	type PayoutScheduleFacts,
	payoutScheduleSweepOf,
	planPayoutRun,
	type ScheduledRunDeps,
	sendScheduledRun,
} from "./payout-schedules.ts";

const at = (iso: string) => new Date(iso);
const MIN = 1_000;

// #region Claim maths
Deno.test("weekly: the next slot is the coming Monday 00:00 UTC, strictly after", () => {
	assertEquals(
		nextPayoutRun("scheduled_weekly", at("2026-11-11T12:00:00Z")),
		at("2026-11-16T00:00:00Z"),
	);
	assertEquals(
		nextPayoutRun("scheduled_weekly", at("2026-11-16T00:00:00Z")),
		at("2026-11-23T00:00:00Z"),
		"a run at the slot itself moves to the next week",
	);
	assertEquals(
		nextPayoutRun("scheduled_weekly", at("2026-11-15T23:59:59Z")),
		at("2026-11-16T00:00:00Z"),
	);
});

Deno.test("monthly: the next slot is the 1st 00:00 UTC, across the year end", () => {
	assertEquals(
		nextPayoutRun("scheduled_monthly", at("2026-11-12T09:30:00Z")),
		at("2026-12-01T00:00:00Z"),
	);
	assertEquals(
		nextPayoutRun("scheduled_monthly", at("2026-12-01T00:00:00Z")),
		at("2027-01-01T00:00:00Z"),
	);
	assertEquals(
		nextPayoutRun("scheduled_monthly", at("2026-01-31T18:00:00Z")),
		at("2026-02-01T00:00:00Z"),
	);
	assertEquals(nextPayoutRun("threshold", at("2026-11-12T09:30:00Z")), null);
	assertEquals(nextPayoutRun("manual", at("2026-11-12T09:30:00Z")), null);
});

const weekly = (nextRunAt: string): PayoutScheduleFacts => ({
	mode: "scheduled_weekly",
	active: true,
	nextRunAt: at(nextRunAt),
	thresholdMinor: null,
});

Deno.test("weekly: due once its slot has come, it pays the whole of Available and skips missed slots", () => {
	const now = at("2026-11-12T10:00:00Z");
	assertEquals(planPayoutRun(weekly("2026-11-16T00:00:00Z"), 50_000, MIN, now), {
		kind: "waiting",
		nextRunAt: at("2026-11-16T00:00:00Z"),
	});
	assertEquals(planPayoutRun(weekly("2026-10-19T00:00:00Z"), 50_000, MIN, now), {
		kind: "pay",
		amountMinor: 50_000,
		nextRunAt: at("2026-11-16T00:00:00Z"),
	}, "three missed Mondays are one run, then the coming Monday");
});

Deno.test("monthly: due on the 1st, then the next month's 1st", () => {
	const facts: PayoutScheduleFacts = {
		mode: "scheduled_monthly",
		active: true,
		nextRunAt: at("2026-12-01T00:00:00Z"),
		thresholdMinor: null,
	};
	const now = at("2026-12-01T00:03:00Z");
	assertEquals(planPayoutRun(facts, 120_000, MIN, now), {
		kind: "pay",
		amountMinor: 120_000,
		nextRunAt: at("2027-01-01T00:00:00Z"),
	});
	assertEquals(planPayoutRun(facts, 120_000, MIN, at("2026-11-30T23:59:00Z")).kind, "waiting");
});

Deno.test("threshold: due once Available reaches the threshold, never on a date", () => {
	const facts: PayoutScheduleFacts = {
		mode: "threshold",
		active: true,
		nextRunAt: null,
		thresholdMinor: 25_000,
	};
	const now = at("2026-11-12T10:00:00Z");
	assertEquals(planPayoutRun(facts, 24_999, MIN, now), { kind: "waiting", nextRunAt: null });
	assertEquals(planPayoutRun(facts, 25_000, MIN, now), {
		kind: "pay",
		amountMinor: 25_000,
		nextRunAt: null,
	});
	assertEquals(planPayoutRun(facts, 31_250, MIN, now), {
		kind: "pay",
		amountMinor: 31_250,
		nextRunAt: null,
	}, "it pays everything Available, not the threshold");
});

Deno.test("below the minimum: a due run is skipped and still advances; nothing is paid", () => {
	const now = at("2026-11-12T10:00:00Z");
	assertEquals(planPayoutRun(weekly("2026-11-09T00:00:00Z"), 999, MIN, now), {
		kind: "skip",
		nextRunAt: at("2026-11-16T00:00:00Z"),
	});
	assertEquals(planPayoutRun(weekly("2026-11-09T00:00:00Z"), 1_000, MIN, now).kind, "pay");
	assertEquals(
		planPayoutRun(weekly("2026-11-09T00:00:00Z"), 0, 0, now).kind,
		"skip",
		"an unset minimum still never pays out nothing",
	);
});

Deno.test("manual and paused schedules are never claimed", () => {
	const now = at("2026-11-12T10:00:00Z");
	assertEquals(
		planPayoutRun({ ...weekly("2026-11-09T00:00:00Z"), active: false }, 50_000, MIN, now),
		{
			kind: "off",
		},
	);
	assertEquals(
		planPayoutRun(
			{ mode: "manual", active: true, nextRunAt: null, thresholdMinor: null },
			50_000,
			MIN,
			now,
		),
		{ kind: "off" },
	);
});
// #endregion

// #region One claimed run
const SCHEDULE_ID = "5c2e1d3f-0a4b-4c5d-8e6f-7a8b9c0d1e2f";
const PAYOUT: Payout = {
	id: "3f1d6c2e-8a4b-4c5d-9e6f-7a8b9c0d1e2f",
	walletId: "4b1d0c2e-9f3a-4d5b-8c6e-7a8b9c0d1e2f",
	destinationMethodId: null,
	scheduleId: SCHEDULE_ID,
	amountCents: 50_000,
	currency: "USD",
	status: "pending",
	instant: false,
	provider: "stripe",
	providerRef: null,
	transactionId: null,
	failureReason: null,
	initiatedAt: "2026-11-16T00:03:00Z",
	settledAt: null,
	createdAt: "2026-11-16T00:03:00Z",
	destinationAccount: "acct_probe",
	reversedCents: 0,
	bankStatus: null,
	bankPayoutRef: null,
	bankFailureCode: null,
	bankStatusAt: null,
	sweptAt: null,
	sweepAttempts: 0,
};

const begun = (over: Partial<PayoutScheduleRun> = {}): PayoutScheduleRun => ({
	scheduleId: SCHEDULE_ID,
	runAt: "2026-11-16T00:00:00Z",
	outcome: "begun",
	amountCents: 50_000,
	currency: "USD",
	payout: PAYOUT,
	destination: "acct_probe",
	replayed: false,
	detail: null,
	code: null,
	paused: false,
	...over,
});

function deps(
	send: ScheduledRunDeps["send"],
): ScheduledRunDeps & { reports: string[]; sent: string[] } {
	const reports: string[] = [];
	const sent: string[] = [];
	return {
		reports,
		sent,
		send: (payout, destination) => {
			sent.push(`${payout.id}->${destination}`);
			return send(payout, destination);
		},
		report: (id, kind) => reports.push(`${id}:${kind}`),
	};
}

Deno.test("a begun run's Transfer goes out once, to the account the claim names", async () => {
	const d = deps((payout) =>
		Promise.resolve({ kind: "sent", payout: { ...payout, status: "paid" } })
	);
	assertEquals(await sendScheduledRun(begun(), d), {
		scheduleId: SCHEDULE_ID,
		outcome: "sent",
		payoutId: PAYOUT.id,
		detail: null,
	});
	assertEquals(d.sent, [`${PAYOUT.id}->acct_probe`]);
});

Deno.test("a refused Transfer is failed; a lost answer, or a throw, is left pending", async () => {
	const refused = await sendScheduledRun(
		begun(),
		deps(() => Promise.resolve({ kind: "refused", code: "account_closed" })),
	);
	assertEquals([refused.outcome, refused.detail], ["failed", "account_closed"]);
	const lost = await sendScheduledRun(
		begun(),
		deps(() => Promise.resolve({ kind: "unknown", message: "socket hang up" })),
	);
	assertEquals([lost.outcome, lost.detail], ["pending", "socket hang up"]);
	const d = deps(() => Promise.reject(new Error("complete_payout failed")));
	const thrown = await sendScheduledRun(begun(), d);
	assertEquals([thrown.outcome, d.reports], ["pending", [`${SCHEDULE_ID}:send`]]);
});

Deno.test("a skip or a refusal is the claim's own answer; nothing is sent", async () => {
	const d = deps(() => Promise.reject(new Error("never called")));
	const skipped = await sendScheduledRun(
		begun({ outcome: "skipped", payout: null, destination: null, detail: "below_minimum" }),
		d,
	);
	const refused = await sendScheduledRun(
		begun({
			outcome: "refused",
			payout: null,
			destination: null,
			detail: "Verify your identity and set up payouts before withdrawing.",
			code: "PK403",
		}),
		d,
	);
	assertEquals([skipped.outcome, skipped.payoutId, refused.outcome], ["skipped", null, "refused"]);
	assertEquals(d.sent, []);
});

Deno.test("a replayed run whose payout already settled is reported as it stands", async () => {
	const d = deps(() => Promise.reject(new Error("never called")));
	const paid = await sendScheduledRun(
		begun({ replayed: true, payout: { ...PAYOUT, status: "paid" } }),
		d,
	);
	assertEquals(paid.outcome, "sent");
	assertEquals(d.sent, []);
});

Deno.test("the sweep counts each outcome", () => {
	const line = (outcome: "sent" | "pending" | "failed" | "skipped" | "refused") => ({
		scheduleId: SCHEDULE_ID,
		outcome,
		payoutId: null,
		detail: null,
	});
	const sweep = payoutScheduleSweepOf([
		line("sent"),
		line("sent"),
		line("skipped"),
		line("refused"),
	]);
	assertEquals(
		[sweep.claimed, sweep.sent, sweep.pending, sweep.failed, sweep.skipped, sweep.refused],
		[4, 2, 0, 0, 1, 1],
	);
});
// #endregion
