import { z } from "zod";
import { currency, minorUnitsNonNeg, timestamp } from "./common.ts";

/**
 * finance escrow age: how long held money has sat in the platform's Stripe balance (MR7,
 * Decision #473). Mirrors `finance.read_escrow_age()` (00001200 "Escrow age"), the operator-only read
 * behind `/admin/ledger`'s Escrow age section and the measured facts in the counsel brief on ruling M2
 * (`FOUNDER_QUESTIONNAIRE.md` Part D, Decision #337, PRD-F15). The database classifies and ages every
 * row; these are the shapes the service maps the jsonb onto.
 */

// #region Kinds
/**
 * What the money is waiting on, one kind per clock (00001200 names each one's source):
 * `held_bound` waits on approval (no timer today), `held_prepaid` on the prepaid TTL (#428),
 * `held_seat` on its sitting (#171, #211), `reserved` on nothing (#430), `disputed` on a ruling
 * (#212), `pending` on the 7-day window (#191), `on_hold` on a card dispute's close (ruling M3).
 */
export const EscrowAgeKind = z.enum([
	"held_bound",
	"held_prepaid",
	"held_seat",
	"reserved",
	"disputed",
	"pending",
	"on_hold",
]);
export type EscrowAgeKind = z.infer<typeof EscrowAgeKind>;

/** The age thresholds, in days, the reader counts and sums past (`over`), in the database's order. */
export const ESCROW_AGE_THRESHOLD_DAYS = [30, 60, 90] as const;
// #endregion

// #region The read
/** The rows of one kind and currency older than `days`. */
export const EscrowAgeOverSchema = z.object({
	days: z.number().int().positive(),
	count: z.number().int().min(0),
	totalMinor: minorUnitsNonNeg,
});
export type EscrowAgeOver = z.infer<typeof EscrowAgeOverSchema>;

/**
 * One kind in one currency. Age runs from when the money entered that state (an escrow's
 * `created_at`, a release's `released_at`), in days to one decimal; a `pending` row counts only what
 * is still outstanding (amount minus any chargeback recovery).
 */
export const EscrowAgeRowSchema = z.object({
	kind: EscrowAgeKind,
	currency,
	count: z.number().int().positive(),
	totalMinor: minorUnitsNonNeg,
	oldestAt: timestamp,
	p50Days: z.number().min(0),
	p90Days: z.number().min(0),
	maxDays: z.number().min(0),
	/** One entry per {@link ESCROW_AGE_THRESHOLD_DAYS}, in that order. */
	over: z.array(EscrowAgeOverSchema),
});
export type EscrowAgeRow = z.infer<typeof EscrowAgeRowSchema>;

/** `finance.read_escrow_age()`: every kind and currency still holding money, by currency, then clock order. */
export const EscrowAgeSchema = z.object({
	asOf: timestamp,
	rows: z.array(EscrowAgeRowSchema),
});
export type EscrowAge = z.infer<typeof EscrowAgeSchema>;
// #endregion
