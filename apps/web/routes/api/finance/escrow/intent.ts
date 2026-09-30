import { define } from "@web/utils/state.ts";
import { CreateEscrowLockIntentSchema } from "@projective/types/finance";
import { readActor } from "@web/utils/api-session.ts";
import { invalidBody, readJson, toPaymentsResponse } from "@features/payments/core/respond.ts";
import { PaymentBackendService } from "@server/services/finance/PaymentBackendService.ts";

/**
 * `POST /api/finance/escrow/intent` — fund a stage's escrow by card (the One-Off upfront lock and the
 * Pipeline "Buy Now" lock).
 *
 * Thin by contract: Zod-validate the body and delegate. The fat {@link PaymentBackendService} records
 * the attempt through `finance.begin_card_payment` — which authorises the caller exactly as
 * `projects.fund_stage` would and computes the amount itself — then creates the Stripe PaymentIntent
 * and answers with its client secret for the Payment Element. Nothing is charged, credited or locked
 * here; the signed `payment_intent.succeeded` webhook does that.
 *
 * Body: `{ projectId, stageId, expectedAmountMinor, currency, idempotencyKey }`. `expectedAmountMinor`
 * is what the payer was SHOWN; a different computed amount is refused (409), never charged.
 */
export const handler = define.handlers({
	async POST(ctx) {
		const parsed = CreateEscrowLockIntentSchema.safeParse(await readJson(ctx.req));
		if (!parsed.success) return invalidBody(parsed.error);
		return toPaymentsResponse(
			await PaymentBackendService.createEscrowLockIntent(parsed.data, readActor(ctx)),
		);
	},
});
