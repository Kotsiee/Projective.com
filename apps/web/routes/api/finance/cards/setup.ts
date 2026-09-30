import { define } from "@web/utils/state.ts";
import { CreateCardSetupSchema } from "@projective/types/finance";
import { readActor } from "@web/utils/api-session.ts";
import { invalidBody, readJson, toPaymentsResponse } from "@features/payments/core/respond.ts";
import { PaymentBackendService } from "@server/services/finance/PaymentBackendService.ts";

/**
 * `POST /api/finance/cards/setup` — start saving a card: answers with a Stripe SetupIntent's client
 * secret for the Payment Element in `setup` mode.
 *
 * Thin by contract: Zod-validate and delegate. The fat {@link PaymentBackendService} authorises the
 * owner (`finance.card_owner_for` — the caller, or a team/business they manage billing for), makes sure
 * the owner has one Stripe Customer, and opens the SetupIntent. Nothing is saved here: the card is
 * recorded by `POST /api/finance/cards/confirm` (or, as a backstop, the `setup_intent.succeeded`
 * webhook) after Stripe confirms it.
 *
 * Body: `{ scope: "personal" | "team" | "business", contextId? }`.
 */
export const handler = define.handlers({
	async POST(ctx) {
		const parsed = CreateCardSetupSchema.safeParse(await readJson(ctx.req));
		if (!parsed.success) return invalidBody(parsed.error);
		return toPaymentsResponse(await PaymentBackendService.createCardSetup(parsed.data, readActor(ctx)));
	},
});
