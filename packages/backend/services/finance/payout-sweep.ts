/**
 * payout-sweep — what the stale-payout sweep does with one withdrawal stuck in `pending` (Decision
 * #202), as a pure decision. A payout sits there when `begin_payout` debited the wallet but the answer
 * to its transfer was lost (network, 5xx) and `transfer.created` never closed it.
 *
 * The transfer's idempotency key (`payout_transfer:<payout id>`) is what makes re-sending safe: within
 * Stripe's 24-hour key life a re-send answers with the SAME transfer if one was made and makes it if
 * not, so the payout can never leave twice. Past that life a re-send could create a second transfer,
 * so a payout with no transfer found by then is returned to the wallet instead.
 */

// #region Decision
/** Stripe keeps an idempotency key for 24 hours; the sweep stops re-sending an hour before. */
export const RESEND_WINDOW_MS = 23 * 60 * 60 * 1000;

/** What the sweep does with one claimed payout. */
export type StalePayoutAction =
	| { kind: "complete"; transfer: string }
	| { kind: "resend" }
	| { kind: "fail"; reason: string };

/**
 * Decide one claimed payout from what Stripe holds for it. `found` is the transfer whose metadata
 * names the payout, or `null` when none exists.
 */
export function planStalePayout(
	payout: { destination: string | null; initiatedAt: string },
	found: { id: string } | null,
	now: number,
): StalePayoutAction {
	if (found) return { kind: "complete", transfer: found.id };
	if (!payout.destination) {
		return { kind: "fail", reason: "no verified payout account to send it to" };
	}
	const started = Date.parse(payout.initiatedAt);
	if (!Number.isFinite(started) || now - started >= RESEND_WINDOW_MS) {
		return { kind: "fail", reason: "no transfer was made and its idempotency key has expired" };
	}
	return { kind: "resend" };
}
// #endregion
