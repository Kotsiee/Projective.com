import { z } from "zod";
import { currency, minorUnitsNonNeg, timestamp, uuid } from "./common.ts";

/**
 * finance AML monitoring signals and the Safety Hold (LEGAL_COMPLIANCE LG7, Decision #529; #336 ruling
 * I1 ⚖️, the data half of "AML-ready"). Mirrors `finance.aml_signals` (00000017) and
 * `finance.read_aml_signals()` (00001240), the operator-only read behind `/admin/ledger`'s AML signals
 * section, and `finance.begin_payout`'s held answer. The money doors record every signal; these are
 * the shapes the services map the jsonb onto.
 */

// #region Kinds
/**
 * What a money door saw: `round_trip` (one person on both sides of an escrow, at its hold or its
 * release), `rapid_churn` (a withdrawal at `aml_churn_min_minor` after as much card money inside
 * `aml_churn_window_hours`) and `safety_hold` (a withdrawal the Safety Hold refused).
 */
export const AmlSignalKind = z.enum(["round_trip", "rapid_churn", "safety_hold"]);
export type AmlSignalKind = z.infer<typeof AmlSignalKind>;

/** How one person is on both sides of an escrow (`finance.fn_aml_round_trip_people`). */
export const AmlRoundTripRelation = z.enum([
	"same_account",
	"business_seat",
	"team_seat",
	"business_and_team_seat",
]);
export type AmlRoundTripRelation = z.infer<typeof AmlRoundTripRelation>;

/** Which events start a Safety Hold (`aml_safety_hold_triggers`). */
export const SafetyHoldTrigger = z.enum([
	"sign_in_change",
	"rapid_churn",
	"round_trip",
	"new_account",
]);
export type SafetyHoldTrigger = z.infer<typeof SafetyHoldTrigger>;
// #endregion

// #region The row
/** A row of `finance.aml_signals`: ids and integer minor units only (Decision #446: no IP, no user agent). */
export const AmlSignalSchema = z.object({
	id: uuid,
	kind: AmlSignalKind,
	/** The person the pattern is about: the one on both sides, or the one withdrawing. */
	subjectUserId: uuid,
	walletId: uuid.nullable(),
	escrowId: uuid.nullable(),
	payoutId: uuid.nullable(),
	amountMinor: minorUnitsNonNeg,
	currency,
	facts: z.record(z.string(), z.unknown()),
	createdAt: timestamp,
});
export type AmlSignal = z.infer<typeof AmlSignalSchema>;
// #endregion

// #region Facts, per kind
/** A `round_trip` signal's facts: when it was seen and how the person is on both sides. */
export const AmlRoundTripFactsSchema = z.object({
	event: z.enum(["funding", "release"]),
	relation: AmlRoundTripRelation,
	ticketId: uuid.nullable(),
	cohortMembershipId: uuid.nullable(),
});
export type AmlRoundTripFacts = z.infer<typeof AmlRoundTripFactsSchema>;

/** A `rapid_churn` signal's facts: the card money that came in, and the dials it was judged by. */
export const AmlChurnFactsSchema = z.object({
	inMinor: minorUnitsNonNeg,
	payments: z.number().int().min(0),
	lastInAt: timestamp,
	minMinor: minorUnitsNonNeg,
	windowHours: z.number().int().min(0),
});
export type AmlChurnFacts = z.infer<typeof AmlChurnFactsSchema>;

/** A `safety_hold` signal's facts: when the hold ends, and which triggers held it. */
export const AmlHoldFactsSchema = z.object({
	heldUntil: timestamp,
	triggers: z.array(SafetyHoldTrigger),
});
export type AmlHoldFacts = z.infer<typeof AmlHoldFactsSchema>;
// #endregion

// #region The operator read
/** One signal as the operator reads it: the row, the subject's handle, and its facts by kind. */
export const AmlSignalViewSchema = z.discriminatedUnion("kind", [
	AmlSignalSchema.omit({ facts: true }).extend({
		kind: z.literal("round_trip"),
		subjectUsername: z.string().nullable(),
		facts: AmlRoundTripFactsSchema,
	}),
	AmlSignalSchema.omit({ facts: true }).extend({
		kind: z.literal("rapid_churn"),
		subjectUsername: z.string().nullable(),
		facts: AmlChurnFactsSchema,
	}),
	AmlSignalSchema.omit({ facts: true }).extend({
		kind: z.literal("safety_hold"),
		subjectUsername: z.string().nullable(),
		facts: AmlHoldFactsSchema,
	}),
]);
export type AmlSignalView = z.infer<typeof AmlSignalViewSchema>;

/** `finance.read_aml_signals()`: the newest signals, every kind's count, and whether the hold is on. */
export const AmlSignalsReadSchema = z.object({
	asOf: timestamp,
	holdEnabled: z.boolean(),
	counts: z.record(AmlSignalKind, z.number().int().min(0)),
	signals: z.array(AmlSignalViewSchema),
});
export type AmlSignalsRead = z.infer<typeof AmlSignalsReadSchema>;
// #endregion

// #region The person's words
/**
 * What a person whose withdrawal the Safety Hold refused is told: when they can withdraw, in plain
 * words, and that the money has not moved. It names no trigger. Pure; pinned by `aml-signals.test.ts`.
 * shortcut: the end is written in UTC, not the person's own zone; use their timezone once the wallet
 * reads it server-side.
 */
export function safetyHoldSentence(heldUntil: string): string {
	const at = new Date(heldUntil);
	const date = at.toLocaleDateString("en-GB", {
		day: "numeric",
		month: "long",
		year: "numeric",
		timeZone: "UTC",
	});
	const time = at.toLocaleTimeString("en-GB", {
		hour: "2-digit",
		minute: "2-digit",
		timeZone: "UTC",
	});
	return `For your security, withdrawals from this account are paused until ${date} at ${time} UTC. Your money stays in your wallet, and you can withdraw it after then.`;
}
// #endregion
