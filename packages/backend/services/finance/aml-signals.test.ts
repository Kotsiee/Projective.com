import { assertEquals } from "@std/assert";
import { AmlSignalsReadSchema } from "@projective/types/finance";
import { type RawAmlSignals, toAmlSignals } from "./aml-signals.ts";

/*
 * finance.read_aml_signals → AmlSignalsRead (LEGAL_COMPLIANCE LG7, Decision #529). An operator reads
 * these facts to judge a pattern, so a wrong mapping would put the wrong person, amount or hold end in
 * front of them.
 */

// #region Fixtures
const PERSON = "1fee216e-a637-4619-a90a-4ae03bb1ed8b";
const ESCROW = "d4e6f3c4-8a98-4bf1-a851-bea6553126b3";
const WALLET = "046c1c0c-b930-458d-a6a3-18c6786538d7";
const PAYOUT = "69bfc4f9-3f67-4d98-b0a8-1a3714327a8c";
const TICKET = "ecc69a9e-46e9-435d-ae63-70e0fc1d2117";

/** The shape `finance.read_aml_signals` wrote on the probe's fixtures (2026-11-23). */
function raw(): RawAmlSignals {
	return {
		as_of: "2026-11-23T16:00:00+00:00",
		hold_enabled: false,
		counts: { round_trip: 1, rapid_churn: 1, safety_hold: 1 },
		signals: [
			{
				id: "a1000000-0000-4000-8000-000000000003",
				kind: "safety_hold",
				subject_user_id: PERSON,
				subject_username: "riley",
				wallet_id: WALLET,
				escrow_id: null,
				payout_id: null,
				amount_minor: 100000,
				currency: "USD",
				facts: {
					held_until: "2026-11-26T14:05:00+00:00",
					triggers: ["rapid_churn"],
					instant: false,
				},
				created_at: "2026-11-23T15:59:00+00:00",
			},
			{
				id: "a1000000-0000-4000-8000-000000000002",
				kind: "rapid_churn",
				subject_user_id: PERSON,
				subject_username: "riley",
				wallet_id: WALLET,
				escrow_id: null,
				payout_id: PAYOUT,
				amount_minor: 100000,
				currency: "USD",
				facts: {
					in_minor: 150000,
					payments: 2,
					last_in_at: "2026-11-23T14:05:00+00:00",
					min_minor: 100000,
					window_hours: 72,
				},
				created_at: "2026-11-23T15:58:00+00:00",
			},
			{
				id: "a1000000-0000-4000-8000-000000000001",
				kind: "round_trip",
				subject_user_id: PERSON,
				subject_username: null,
				wallet_id: null,
				escrow_id: ESCROW,
				payout_id: null,
				amount_minor: 240000,
				currency: "USD",
				facts: {
					event: "funding",
					relation: "same_account",
					ticket_id: TICKET,
					payer_user_id: PERSON,
				},
				created_at: "2026-11-23T15:57:00+00:00",
			},
		],
	};
}
// #endregion

Deno.test("aml signals: every kind maps to the camelCase read and parses, newest first", () => {
	const read = toAmlSignals(raw());
	assertEquals(AmlSignalsReadSchema.parse(read), read);
	assertEquals(read.holdEnabled, false);
	assertEquals(read.counts, { round_trip: 1, rapid_churn: 1, safety_hold: 1 });
	assertEquals(read.signals.map((s) => s.kind), ["safety_hold", "rapid_churn", "round_trip"]);
	assertEquals(read.signals[0].facts, {
		heldUntil: "2026-11-26T14:05:00+00:00",
		triggers: ["rapid_churn"],
	});
	assertEquals(read.signals[1].facts, {
		inMinor: 150000,
		payments: 2,
		lastInAt: "2026-11-23T14:05:00+00:00",
		minMinor: 100000,
		windowHours: 72,
	});
	assertEquals(read.signals[2], {
		id: "a1000000-0000-4000-8000-000000000001",
		kind: "round_trip",
		subjectUserId: PERSON,
		subjectUsername: null,
		walletId: null,
		escrowId: ESCROW,
		payoutId: null,
		amountMinor: 240000,
		currency: "USD",
		createdAt: "2026-11-23T15:57:00+00:00",
		facts: {
			event: "funding",
			relation: "same_account",
			ticketId: TICKET,
			cohortMembershipId: null,
		},
	});
});

Deno.test("aml signals: an unknown kind or facts that do not parse are dropped, never guessed", () => {
	const input = raw();
	input.signals!.push({ ...input.signals![2], kind: "structuring" });
	input.signals!.push({
		...input.signals![2],
		id: "a1000000-0000-4000-8000-000000000009",
		facts: { event: "x" },
	});
	assertEquals(toAmlSignals(input).signals.length, 3);
});

Deno.test("aml signals: an empty answer reads as no signals, zero counts and the hold off", () => {
	assertEquals(toAmlSignals(null), {
		asOf: new Date(0).toISOString(),
		holdEnabled: false,
		counts: { round_trip: 0, rapid_churn: 0, safety_hold: 0 },
		signals: [],
	});
});
