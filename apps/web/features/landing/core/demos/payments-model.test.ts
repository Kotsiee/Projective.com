/**
 * payments-model.test — the Payment protection demo against the database's own arithmetic and the
 * copy deck: the release and Fair Exit mirrors reproduce `flows/LANDING.md` §5 rows C4, C5 and F5 by
 * the SQL formulas (`supabase/migrations/00001200_functions_finance_core.sql:742-745`, `:914-930`;
 * `00001150_functions_projects_stage_funding_submissions.sql:1166-1170`) and figures read back from
 * the live `finance.fn_fair_exit_split`; then the journey (C2, D1, E1, E2, F3–F6), the fee-unavailable
 * fallbacks (§4) and the frames, verbatim (§4.4).
 */
import { assert, assertEquals, assertThrows } from "@std/assert";
import { PLATFORM_FEE_BP, platformFeeFor } from "@projective/types/finance";
import {
	approvedLine,
	clampStop,
	FAIR_EXIT_FROM_STOP,
	FAIR_EXIT_TIERS,
	fairExitLines,
	fairExitPrompt,
	fairExitSplit,
	feeRate,
	isFairExitTier,
	JOURNEY,
	JOURNEY_LABEL,
	money,
	PAYMENTS_FIXTURE,
	paymentsFrames,
	paymentsView,
	price,
	projectLine,
	releaseSplit,
	stopLines,
} from "./payments-model.ts";

const BP = PLATFORM_FEE_BP;

// #region Release — fn_release_ticket_escrow (00001200:742-745)
Deno.test("release: C4 — £2,000 and £1,500 stages at 500 bp", () => {
	// floor(200000 × 500 / 10000) = 10000 → 190000; floor(150000 × 500 / 10000) = 7500 → 142500.
	assertEquals(releaseSplit(200_000, BP), {
		grossMinor: 200_000,
		feeMinor: 10_000,
		payoutMinor: 190_000,
	});
	assertEquals(releaseSplit(150_000, BP), {
		grossMinor: 150_000,
		feeMinor: 7_500,
		payoutMinor: 142_500,
	});
});

Deno.test("release: C5 — the fee on £10.50 truncates to 52p, the team receives £9.98", () => {
	// floor(1050 × 500 / 10000) = floor(52.5) = 52.
	assertEquals(releaseSplit(1_050, BP), { grossMinor: 1_050, feeMinor: 52, payoutMinor: 998 });
	assertEquals(money(52), "£0.52");
	assertEquals(money(998), "£9.98");
});

Deno.test("release: the fee is the SQL's integer division at every amount and rate", () => {
	for (const bp of [0, 1, 250, 500, 799, 1000, 10_000]) {
		for (let amount = 1; amount <= 5_000; amount += 37) {
			const sql = Math.trunc((amount * bp) / 10_000);
			assertEquals(releaseSplit(amount, bp).feeMinor, sql, `${amount} @ ${bp}`);
			assertEquals(releaseSplit(amount, bp).payoutMinor, amount - sql);
		}
	}
});

Deno.test("release: a deadline bonus is paid on top and never fee'd; the payout never goes below 0", () => {
	// payout := amount + bonus − fee (00001200:744); the fee is on amount_cents only (:743).
	assertEquals(releaseSplit(200_000, BP, 5_000).payoutMinor, 195_000);
	assertEquals(releaseSplit(200_000, BP, 5_000).feeMinor, 10_000);
	assertEquals(releaseSplit(100, 10_000).payoutMinor, 0);
});
// #endregion

// #region Fair Exit — fn_fair_exit_split (00001200:914-930), tiers (00001150:1166-1170)
Deno.test("fair exit: F5 — a £2,000 stage at 25%, 50% and 75%", () => {
	// share = 200000 × bp / 10000; fee = share × 500 / 10000; payout = share − fee; refund = amount − share.
	assertEquals(fairExitSplit(200_000, 25, BP), {
		shareMinor: 50_000,
		feeMinor: 2_500,
		payoutMinor: 47_500,
		refundMinor: 150_000,
	});
	assertEquals(fairExitSplit(200_000, 50, BP), {
		shareMinor: 100_000,
		feeMinor: 5_000,
		payoutMinor: 95_000,
		refundMinor: 100_000,
	});
	assertEquals(fairExitSplit(200_000, 75, BP), {
		shareMinor: 150_000,
		feeMinor: 7_500,
		payoutMinor: 142_500,
		refundMinor: 50_000,
	});
	// §5 F5 in words: "the team gets £950. You get £1,000 back".
	assertEquals(money(95_000), "£950.00");
	assertEquals(money(100_000), "£1,000.00");
});

Deno.test("fair exit: matches figures read back from the live finance.fn_fair_exit_split", () => {
	// `SELECT (finance.fn_fair_exit_split(a, t * 100, 500)).*` on the local database, 2026-10-19.
	const live: Array<[number, number, [number, number, number, number]]> = [
		[150_000, 25, [37_500, 1_875, 35_625, 112_500]],
		[150_000, 50, [75_000, 3_750, 71_250, 75_000]],
		[150_000, 75, [112_500, 5_625, 106_875, 37_500]],
		[1_050, 50, [525, 26, 499, 525]],
		[1_999, 25, [499, 24, 475, 1_500]],
		[1_999, 75, [1_499, 74, 1_425, 500]],
	];
	for (const [amount, tier, [share, fee, payout, refund]] of live) {
		assertEquals(fairExitSplit(amount, tier, BP), {
			shareMinor: share,
			feeMinor: fee,
			payoutMinor: payout,
			refundMinor: refund,
		}, `${amount} at ${tier}%`);
	}
});

Deno.test("fair exit: the fee falls on the earned share only, and every penny is accounted for", () => {
	for (const tier of FAIR_EXIT_TIERS) {
		for (let amount = 1; amount <= 20_000; amount += 113) {
			const split = fairExitSplit(amount, tier, BP);
			assertEquals(split.feeMinor, platformFeeFor(split.shareMinor, BP));
			assertEquals(split.payoutMinor + split.feeMinor + split.refundMinor, amount);
			assert(split.refundMinor >= 0 && split.payoutMinor >= 0);
		}
	}
});

Deno.test("fair exit: only 25, 50 or 75 — the door refuses any other tier", () => {
	assertEquals([...FAIR_EXIT_TIERS], [25, 50, 75]);
	for (const tier of [0, 10, 33, 100, 50.5, Number.NaN]) {
		assertThrows(() => fairExitSplit(200_000, tier, BP), RangeError);
		assert(!isFairExitTier(tier));
	}
});
// #endregion

// #region Formatting
Deno.test("formatting: GBP en-GB figures, whole fixture prices, the fee rate", () => {
	assertEquals(money(142_500), "£1,425.00");
	assertEquals(price(150_000), "£1,500");
	assertEquals(price(142_550), "£1,425.50");
	assertEquals(feeRate(500), "5%");
	assertEquals(feeRate(250), "2.5%");
	assertEquals(feeRate(1_234), "12.34%");
	assertEquals(projectLine(), "A £5,000 project in 3 stages");
});
// #endregion

// #region The journey
Deno.test("journey: the five stops and their labels, verbatim (§4.4)", () => {
	assertEquals(JOURNEY.map((stop) => JOURNEY_LABEL[stop]), [
		"Held safely",
		"You approve",
		"Team paid",
		"Clears in 7 days",
		"Withdraw to bank",
	]);
	assertEquals(clampStop(-3), 0);
	assertEquals(clampStop(9), 4);
	assertEquals(clampStop(2.7), 2);
	assertEquals(clampStop(Number.NaN), 0);
});

Deno.test("journey: held — the wallet goes down by exactly Stage 1's price, no fee on top (C2, K4)", () => {
	const view = paymentsView({ stop: 0, fairExit: null }, BP);
	assertEquals(view.walletMinor, 500_000 - 150_000);
	assertEquals(view.stages.map((stage) => stage.status), ["funded", null, null]);
	assertEquals(view.release, null);
	assertEquals(view.team, {
		paid: false,
		withdrawing: false,
		clearingMinor: null,
		availableMinor: null,
		withdrawingMinor: null,
	});
	assertEquals(paymentsView({ stop: 1, fairExit: null }, BP), {
		...view,
		stop: 1,
		stopId: "approve",
	});
});

Deno.test("journey: approved — the team receives the net, and Chain Reaction holds Stage 2 (C4, D1, E1)", () => {
	const view = paymentsView({ stop: 2, fairExit: null }, BP);
	assertEquals(view.release, { grossMinor: 150_000, feeMinor: 7_500, payoutMinor: 142_500 });
	assertEquals(view.stages.map((stage) => stage.status), ["team_paid", "funded", null]);
	assertEquals(view.walletMinor, 500_000 - 150_000 - 200_000);
	assertEquals(view.team, {
		paid: true,
		withdrawing: false,
		clearingMinor: 142_500,
		availableMinor: 0,
		withdrawingMinor: 0,
	});
	assertEquals(paymentsView({ stop: 3, fairExit: null }, BP).team, view.team);
});

Deno.test("journey: withdraw — the withdrawal takes the cleared money out of Available at once (E1, E2)", () => {
	const view = paymentsView({ stop: 4, fairExit: null }, BP);
	// `begin_payout` debits the wallet when the payout starts: the money is on its way, not Available.
	assertEquals(view.team, {
		paid: true,
		withdrawing: true,
		clearingMinor: 0,
		availableMinor: 0,
		withdrawingMinor: 142_500,
	});
	assertEquals(view.walletMinor, 150_000);
	const team = view.team;
	assertEquals(
		(team.clearingMinor ?? 0) + (team.availableMinor ?? 0) + (team.withdrawingMinor ?? 0),
		view.release?.payoutMinor,
		"the team's payout is in exactly one place",
	);
});

Deno.test("journey: a short wallet leaves Stage 2 unheld — Chain Reaction never overdraws", () => {
	const fixture = { ...PAYMENTS_FIXTURE, walletMinor: 300_000 };
	const view = paymentsView({ stop: 2, fairExit: null }, BP, fixture);
	assertEquals(view.stages.map((stage) => stage.status), ["team_paid", null, null]);
	assertEquals(view.walletMinor, 150_000);
});

Deno.test("fair exit: Stage 2 ends at the tier — the team's share clears, the rest is back at once, Cancelled (F3–F6)", () => {
	for (const tier of FAIR_EXIT_TIERS) {
		const split = fairExitSplit(200_000, tier, BP);
		for (const stop of [0, 2, 4]) {
			const view = paymentsView({ stop, fairExit: tier }, BP);
			assertEquals(view.stop, FAIR_EXIT_FROM_STOP);
			assertEquals(view.stages.map((stage) => stage.status), ["team_paid", "cancelled", null]);
			assertEquals(view.exit, { stageId: "stage-2", tier, ...split });
			assertEquals(view.walletMinor, 150_000 + split.refundMinor);
			assertEquals(view.team.clearingMinor, 142_500 + split.payoutMinor);
		}
	}
});

Deno.test("fee unavailable: every after-fee figure is null; the share and the refund stand", () => {
	const paid = paymentsView({ stop: 2, fairExit: null }, null);
	assertEquals(paid.release, { grossMinor: 150_000, feeMinor: null, payoutMinor: null });
	assertEquals(paid.team.clearingMinor, null);
	const exit = paymentsView({ stop: 2, fairExit: 50 }, null);
	assertEquals(exit.exit, {
		stageId: "stage-2",
		tier: 50,
		shareMinor: 100_000,
		feeMinor: null,
		payoutMinor: null,
		refundMinor: 100_000,
	});
	assertEquals(exit.walletMinor, 250_000);
});

Deno.test("purity: the same choice always draws the same picture, both ways along the scrubber", () => {
	const forward = JOURNEY.map((_, stop) => paymentsView({ stop, fairExit: null }, BP));
	const back = [...JOURNEY.keys()].reverse().map((stop) =>
		paymentsView({ stop, fairExit: null }, BP)
	);
	assertEquals(forward, back.reverse());
});
// #endregion

// #region Copy
Deno.test("frames: the six frames, verbatim, with the 5% fee (§4.4)", () => {
	assertEquals(paymentsFrames(BP).map((frame) => frame.lines), [
		[
			"You pay £1,500 for Stage 1. It's held safely, marked Funded.",
			"Your wallet goes down by exactly £1,500, with no fee on top.",
		],
		["The team works. Your money stays held."],
		["You approve. The team receives £1,425.00 after the 5% fee."],
		["Their money clears in 7 days. Then they withdraw it to their bank."],
		["Stage 2 is paid for from your wallet, so work keeps going."],
		[
			"Work stopped on Stage 2? Pick 25%, 50% or 75% done.",
			"At 50%: the team gets £950.00. You get £1,000.00 back, fee-free.",
		],
	]);
});

Deno.test("frames: without the fee, frame 3 says the team is paid and frame 6 drops its figures (§4)", () => {
	const lines = paymentsFrames(null).map((frame) => frame.lines);
	assertEquals(lines[2], ["You approve. The team is paid."]);
	assertEquals(lines[5], ["Work stopped on Stage 2? Pick 25%, 50% or 75% done."]);
	assertEquals(approvedLine(150_000, null), "You approve. The team is paid.");
	assertEquals(fairExitPrompt(), "Work stopped on Stage 2? Pick 25%, 50% or 75% done.");
	for (const text of lines.flat()) assert(!/fee\b(?!-free| on top)/.test(text), text);
});

Deno.test("frames: each frame draws a state the journey can reach", () => {
	for (const frame of paymentsFrames(BP)) {
		const view = paymentsView(frame.choice, BP);
		assert(view.stages.some((stage) => stage.id === frame.focus));
	}
	assertEquals(paymentsView(paymentsFrames(BP)[5].choice, BP).exit?.tier, 50);
});

Deno.test("live lines: each stop says its frames' sentences, and the withdrawal's outcome (E2)", () => {
	const at = (stop: number) => stopLines(paymentsView({ stop, fairExit: null }, BP), BP);
	assertEquals(at(2), [
		"You approve. The team receives £1,425.00 after the 5% fee.",
		"Stage 2 is paid for from your wallet, so work keeps going.",
	]);
	assertEquals(at(3), ["Their money clears in 7 days."]);
	assertEquals(at(4), [
		"Then they withdraw it to their bank.",
		"Withdrawal started. Stripe sends it to the bank.",
	]);
});

Deno.test("fair exit lines: the results, verbatim, and the claims' words without the fee (F3, F4, E1)", () => {
	assertEquals(fairExitLines(paymentsView({ stop: 2, fairExit: 50 }, BP)), {
		team: "Team receives £950.00 · clears in 7 days",
		back: "Back to you £1,000.00 · straight away, no fee",
	});
	assertEquals(fairExitLines(paymentsView({ stop: 2, fairExit: 25 }, BP)), {
		team: "Team receives £475.00 · clears in 7 days",
		back: "Back to you £1,500.00 · straight away, no fee",
	});
	assertEquals(fairExitLines(paymentsView({ stop: 2, fairExit: 75 }, BP)), {
		team: "Team receives £1,425.00 · clears in 7 days",
		back: "Back to you £500.00 · straight away, no fee",
	});
	assertEquals(fairExitLines(paymentsView({ stop: 2, fairExit: 50 }, null)), {
		team: "Team paid · clears in 7 days",
		back: "The rest comes straight back to you, fee-free.",
	});
	assertEquals(fairExitLines(paymentsView({ stop: 2, fairExit: null }, BP)), null);
});

Deno.test("copy: no banned word reaches the demo (§4 'Banned in page copy')", () => {
	const banned =
		/\b(escrow|release|squad|instant payout|until you approve|only paid when you approve)\b/i;
	const text = [
		...paymentsFrames(BP).flatMap((frame) => frame.lines),
		...paymentsFrames(null).flatMap((frame) => frame.lines),
		...JOURNEY.flatMap((stop) =>
			stopLines(paymentsView({ stop: JOURNEY.indexOf(stop), fairExit: null }, BP), BP)
		),
		...Object.values(JOURNEY_LABEL),
	];
	for (const line of text) assert(!banned.test(line), line);
});
// #endregion
