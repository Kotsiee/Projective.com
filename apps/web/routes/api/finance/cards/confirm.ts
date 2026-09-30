import { define } from "@web/utils/state.ts";
import { ConfirmCardSetupSchema } from "@projective/types/finance";
import { readActor } from "@web/utils/api-session.ts";
import { invalidBody, readJson, toPaymentsResponse } from "@features/payments/core/respond.ts";
import { PaymentBackendService } from "@server/services/finance/PaymentBackendService.ts";

/**
 * `POST /api/finance/cards/confirm` — record the card a confirmed SetupIntent saved.
 *
 * Thin by contract. The browser's "confirmed" is only a prompt: the fat {@link PaymentBackendService}
 * re-reads the SetupIntent from Stripe and records the card only when it succeeded, on the owner's own
 * Customer, for that owner — then stores the display facts Stripe returned (brand, last four, expiry)
 * and never anything that could charge the card.
 *
 * Body: `{ setupIntentId, scope, contextId?, makeDefault? }`.
 */
export const handler = define.handlers({
	async POST(ctx) {
		const parsed = ConfirmCardSetupSchema.safeParse(await readJson(ctx.req));
		if (!parsed.success) return invalidBody(parsed.error);
		return toPaymentsResponse(await PaymentBackendService.confirmCardSetup(parsed.data, readActor(ctx)));
	},
});
