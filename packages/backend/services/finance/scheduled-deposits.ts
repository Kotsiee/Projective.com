import type { ClaimedDeposit } from "./live-payments.ts";
import { classifyStripeError } from "./stripe-rails.ts";

/**
 * scheduled-deposits — what the recurring-deposit sweep does with ONE claimed run, with the Stripe
 * call and the database door injected so the decision is testable without either.
 *
 * The run's off-session PaymentIntent is created under the idempotency key
 * `scheduled_deposit:<payment id>` (stripe-rails `createOffSessionPaymentIntent`), so the same run sent
 * twice inside Stripe's 24-hour key life is ONE charge. That is what makes a transient failure safe to
 * leave alone: the run stays unbound (`requires_payment`, no `provider_ref`), and
 * `finance.claim_due_deposit_rules` re-offers the SAME payment on a later sweep (`retry: true`) — the
 * re-send answers with the intent Stripe already made, or makes it now — instead of the period being
 * lost behind the rule's advanced `next_run_at`. Only a deterministic refusal (a declined card, an
 * off-session authentication the bank requires) is recorded against the rule, as before.
 */

// #region Contract
/** What happened to one run. */
export type DepositChargeOutcome =
	/** Stripe made (or replayed) the intent and the run is bound to it; the webhook settles it. */
	| "charged"
	/** Stripe refused it for a reason a retry cannot change; recorded as a strike on the rule. */
	| "refused"
	/** Nothing durable happened (processor or database unreachable); the next sweep re-offers it. */
	| "pending";

/** The two side effects a run needs, injected. */
export interface DepositChargeDeps {
	/** Create the off-session PaymentIntent under `scheduled_deposit:<payment id>`. */
	createIntent(run: ClaimedDeposit): Promise<{ id: string }>;
	/** `finance.bind_scheduled_payment`: bind the run to its intent, or record the refusal. */
	bind(paymentId: string, providerRef: string | null, error: string | null): Promise<unknown>;
	/** Where a pending run is reported (defaults to `console.error`). */
	report?(paymentId: string, kind: string, message: string): void;
}
// #endregion

// #region Decision
/**
 * Whether a Stripe error is a deterministic refusal of THIS charge. An idempotency error is not: the
 * run's request never changes, so it means the same key is still in flight (an overlapping sweep) —
 * the run is left for the next sweep, which then gets the stored answer.
 */
export function isDeterministicRefusal(error: unknown): boolean {
	const type = (error as { type?: unknown } | null)?.type;
	if (type === "StripeIdempotencyError") return false;
	return classifyStripeError(error).kind === "refused";
}

/** The PaymentIntent a refused off-session confirmation still created, when Stripe reports one. */
function refusedIntentId(error: unknown): string | null {
	const id = (error as { raw?: { payment_intent?: { id?: unknown } } } | null)?.raw?.payment_intent
		?.id;
	return typeof id === "string" && id.length > 0 ? id : null;
}

/**
 * Charge one claimed run. Never throws: a failure to reach Stripe or the database leaves the run
 * unbound and reports it `pending`, which is exactly the state the next sweep re-offers.
 */
export async function chargeScheduledDeposit(
	run: ClaimedDeposit,
	deps: DepositChargeDeps,
): Promise<DepositChargeOutcome> {
	const report = deps.report ??
		((id: string, kind: string, message: string) =>
			console.error("[payments:deposits]", id, kind, message));
	let intentId: string;
	try {
		intentId = (await deps.createIntent(run)).id;
	} catch (error) {
		if (!isDeterministicRefusal(error)) {
			const failure = classifyStripeError(error);
			report(run.payment.id, failure.kind, failure.message);
			return "pending";
		}
		const failure = classifyStripeError(error);
		try {
			await deps.bind(run.payment.id, refusedIntentId(error), failure.code ?? "card refused");
			return "refused";
		} catch (bindError) {
			// The refusal is Stripe's stored answer for this key: the next sweep re-sends, gets the same
			// refusal back and records it then.
			report(
				run.payment.id,
				"bind",
				bindError instanceof Error ? bindError.message : String(bindError),
			);
			return "pending";
		}
	}
	try {
		await deps.bind(run.payment.id, intentId, null);
		return "charged";
	} catch (bindError) {
		// The intent exists but is not recorded against the run. The next sweep re-sends under the same
		// key, Stripe answers with this intent, and the bind is made then; the settlement webhook that
		// arrives first is answered 5xx (no payment bound yet) and redelivered until it is.
		report(
			run.payment.id,
			"bind",
			bindError instanceof Error ? bindError.message : String(bindError),
		);
		return "pending";
	}
}
// #endregion
