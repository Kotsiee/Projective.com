import { define } from "@web/utils/state.ts";
import { CreateTopUpIntentSchema } from "@projective/types/finance";
import { readActor } from "@web/utils/api-session.ts";
import { invalidBody, readJson, toPaymentsResponse } from "@features/payments/core/respond.ts";
import { PaymentBackendService } from "@server/services/finance/PaymentBackendService.ts";

/**
 * `POST /api/finance/topup/intent` — top a wallet up by card: the processor half of the wallet's
 * "Top up" action, which the wallet surface still refuses until its Payment Element lands (Phase 2).
 *
 * Thin by contract: Zod-validate and delegate to {@link PaymentBackendService}, which records the
 * attempt through `finance.begin_card_payment` (a personal wallet is self-only; a shared vault needs
 * the `add_funds` capability) and answers with the PaymentIntent's client secret. The wallet is
 * credited only by the signed `payment_intent.succeeded` webhook.
 *
 * Body: `{ walletId, amountMinor, currency, idempotencyKey }` — the currency must be the wallet's own.
 */
export const handler = define.handlers({
	async POST(ctx) {
		const parsed = CreateTopUpIntentSchema.safeParse(await readJson(ctx.req));
		if (!parsed.success) return invalidBody(parsed.error);
		return toPaymentsResponse(
			await PaymentBackendService.createTopUpIntent(parsed.data, readActor(ctx)),
		);
	},
});
