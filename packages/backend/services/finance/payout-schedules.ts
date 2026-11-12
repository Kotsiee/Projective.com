import type {
	Payout,
	PayoutMode,
	PayoutScheduleRun,
	PayoutScheduleSweep,
	PayoutScheduleSweepOutcome,
} from "@projective/types/finance";

/**
 * payout-schedules — the TypeScript half of the payout-schedule engine (Decision #337, ruling M6;
 * FINANCE_AUDIT A14).
 *
 * The database owns every decision that moves money: `finance.fn_claim_due_payout_schedules` claims
 * the due schedules under SKIP LOCKED, advances each, and debits the whole of Available as the
 * schedule's author through `finance.begin_payout` in the same transaction. This module holds:
 *
 * 1. **The claim maths** ({@link nextPayoutRun}, {@link planPayoutRun}) — the same rules as
 *    `finance.fn_payout_schedule_next_run` and the claim's due test, so the wallet can say when a
 *    schedule next pays and what it would do now. `supabase/probes/payout_schedules.sql` holds the SQL
 *    to the same cases the unit tests hold these to.
 * 2. **One claimed run's send** ({@link sendScheduledRun}) — a begun run's Stripe Transfer goes out
 *    through the SAME send a manual withdrawal uses, injected here so the decision is testable. Its
 *    Stripe idempotency key is the payout's (`payout_transfer:<payout id>`), and the payout is one-to-
 *    one with the run's attempt key (`payout_schedule:<schedule>:<run_at>`), so a re-send is one
 *    Transfer and the stale-payout sweep can close a lost answer under that same key.
 */

// #region Claim maths
const DAY_MS = 86_400_000;

/**
 * The calendar slot after `after` at which a weekly or monthly schedule next runs — Monday 00:00 UTC
 * or the 1st 00:00 UTC, strictly later — and `null` for manual and threshold
 * (`finance.fn_payout_schedule_next_run`).
 */
export function nextPayoutRun(mode: PayoutMode, after: Date): Date | null {
	if (mode === "scheduled_weekly") {
		const midnight = Date.UTC(after.getUTCFullYear(), after.getUTCMonth(), after.getUTCDate());
		const sinceMonday = (new Date(midnight).getUTCDay() + 6) % 7;
		return new Date(midnight - sinceMonday * DAY_MS + 7 * DAY_MS);
	}
	if (mode === "scheduled_monthly") {
		return new Date(Date.UTC(after.getUTCFullYear(), after.getUTCMonth() + 1, 1));
	}
	return null;
}

/** The schedule facts the claim reads. */
export interface PayoutScheduleFacts {
	mode: PayoutMode;
	active: boolean;
	/** A weekly or monthly schedule's stored slot. */
	nextRunAt: Date | null;
	thresholdMinor: number | null;
}

/** What the claim would do with a schedule now. */
export type PayoutRunPlan =
	/** Manual, or paused: the engine never claims it. */
	| { kind: "off" }
	/** Not due: a slot still ahead (`nextRunAt`), or a threshold Available has not reached (`null`). */
	| { kind: "waiting"; nextRunAt: Date | null }
	/** Due, but Available is below the minimum withdrawal: it advances and pays nothing, no strike. */
	| { kind: "skip"; nextRunAt: Date | null }
	/** Due: it pays the whole of Available and advances to `nextRunAt`. */
	| { kind: "pay"; amountMinor: number; nextRunAt: Date | null };

/**
 * The claim's due test and amount (`finance.fn_claim_due_payout_schedules`): a weekly or monthly
 * schedule is due once its slot has come, a threshold one once Available reaches the threshold. A due
 * run pays the whole of Available, or is skipped below the currency's minimum (never less than one
 * minor unit), and advances to the slot after `now` — a missed slot is skipped, never paid in a burst.
 */
export function planPayoutRun(
	schedule: PayoutScheduleFacts,
	availableMinor: number,
	minimumMinor: number,
	now: Date,
): PayoutRunPlan {
	if (!schedule.active || schedule.mode === "manual") return { kind: "off" };
	const available = Math.max(0, Math.trunc(availableMinor));
	const due = schedule.mode === "threshold"
		? schedule.thresholdMinor !== null && available >= schedule.thresholdMinor
		: schedule.nextRunAt !== null && schedule.nextRunAt.getTime() <= now.getTime();
	if (!due) {
		return {
			kind: "waiting",
			nextRunAt: schedule.mode === "threshold" ? null : schedule.nextRunAt,
		};
	}
	const nextRunAt = nextPayoutRun(schedule.mode, now);
	if (available < Math.max(Math.trunc(minimumMinor), 1)) return { kind: "skip", nextRunAt };
	return { kind: "pay", amountMinor: available, nextRunAt };
}
// #endregion

// #region One claimed run
/** What sending one begun payout's Transfer came to (the send a manual withdrawal shares). */
export type PayoutTransferSend =
	/** The Transfer exists and the payout is closed `paid`. */
	| { kind: "sent"; payout: Payout }
	/** Stripe refused it; the payout is `failed` and its money is back in the wallet. */
	| { kind: "refused"; code: string | null }
	/** Stripe's answer was lost; the payout stays `pending` with the money held. */
	| { kind: "unknown"; message: string };

/** The send a run needs, injected. */
export interface ScheduledRunDeps {
	/** Send a begun payout's Transfer to its Connect account and close it. */
	send(payout: Payout, destination: string): Promise<PayoutTransferSend>;
	/** Where a run left pending is reported (defaults to `console.error`). */
	report?(scheduleId: string, kind: string, message: string): void;
}

/** One run's line in the sweep's answer. */
export type ScheduledRunResult = PayoutScheduleSweep["results"][number];

function line(
	run: PayoutScheduleRun,
	outcome: PayoutScheduleSweepOutcome,
	detail: string | null,
): ScheduledRunResult {
	return {
		scheduleId: run.scheduleId,
		outcome,
		payoutId: run.payout?.id ?? null,
		detail: detail === null ? null : detail.slice(0, 400),
	};
}

/**
 * What the sweep does with one claimed run. A skip or a refusal is the claim's own answer. A begun run
 * is sent: `sent`, `failed` (Stripe refused; `finance.fail_payout` returned the money and counted the
 * refusal against the schedule) or `pending` (the answer was lost, or the payout could not be closed;
 * the `transfer.created` webhook or the stale-payout sweep closes it). A replayed run whose payout is
 * already settled is reported as it stands. Never throws, so one run cannot stop the others.
 */
export async function sendScheduledRun(
	run: PayoutScheduleRun,
	deps: ScheduledRunDeps,
): Promise<ScheduledRunResult> {
	if (run.outcome === "skipped") return line(run, "skipped", run.detail);
	if (run.outcome === "refused") return line(run, "refused", run.detail);
	const report = deps.report ??
		((id: string, kind: string, message: string) =>
			console.error("[payments:payout-schedules]", id, kind, message));
	const payout = run.payout;
	if (!payout) {
		report(run.scheduleId, "claim", "a begun run carried no payout");
		return line(run, "pending", "The claim returned no payout.");
	}
	if (payout.status === "paid" || payout.status === "reversed") return line(run, "sent", null);
	if (payout.status === "failed" || payout.status === "cancelled") {
		return line(run, "failed", payout.failureReason);
	}
	if (!run.destination) {
		report(run.scheduleId, "destination", "no verified payout account to send to");
		return line(run, "pending", "No verified payout account to send to.");
	}
	try {
		const sent = await deps.send(payout, run.destination);
		if (sent.kind === "sent") return line(run, "sent", null);
		if (sent.kind === "refused") {
			return line(run, "failed", sent.code ?? "refused by the processor");
		}
		return line(run, "pending", sent.message);
	} catch (error) {
		const message = error instanceof Error ? error.message : String(error);
		report(run.scheduleId, "send", message);
		return line(run, "pending", message);
	}
}

/** The sweep's answer from its runs' lines. */
export function payoutScheduleSweepOf(results: readonly ScheduledRunResult[]): PayoutScheduleSweep {
	const count = (outcome: PayoutScheduleSweepOutcome) =>
		results.filter((r) => r.outcome === outcome).length;
	return {
		claimed: results.length,
		sent: count("sent"),
		pending: count("pending"),
		failed: count("failed"),
		skipped: count("skipped"),
		refused: count("refused"),
		results: [...results],
	};
}
// #endregion
