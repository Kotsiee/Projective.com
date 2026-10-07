import { define } from "@web/utils/state.ts";
import { CreateCardSetupSchema } from "@projective/types/finance";
import { readActor } from "@web/utils/api-session.ts";
import { invalidBody, readJson, toPaymentsResponse } from "@features/payments/core/respond.ts";
import { PaymentBackendService } from "@server/services/finance/PaymentBackendService.ts";

/**
 * `/api/finance/cards/setup` — the two halves of saving a card with Stripe's deferred-intent flow.
 *
 * `GET` answers `{ publishableKey, mode }`: enough to mount the card form straight away, before any
 * SetupIntent exists. `POST` — called when the person presses Save, after the form has collected the
 * card — answers with a Stripe SetupIntent's client secret, which `stripe.confirmSetup` confirms.
 *
 * Thin by contract: Zod-validate and delegate. The fat {@link PaymentBackendService} authorises the
 * owner (`finance.card_owner_for` — the caller, or a team/business they manage billing for), makes sure
 * the owner has one Stripe Customer, and opens the SetupIntent. Nothing is saved here: the card is
 * recorded by `POST /api/finance/cards/confirm` (or, as a backstop, the `setup_intent.succeeded`
 * webhook) after Stripe confirms it.
 *
 * `POST` body: `{ scope: "personal" | "team" | "business", contextId? }`.
 */
export const handler = define.handlers({
	GET(ctx) {
		return toPaymentsResponse(PaymentBackendService.cardSetupConfig(readActor(ctx)));
	},

	async POST(ctx) {
		const parsed = CreateCardSetupSchema.safeParse(await readJson(ctx.req));
		if (!parsed.success) return invalidBody(parsed.error);
		return toPaymentsResponse(await PaymentBackendService.createCardSetup(parsed.data, readActor(ctx)));
	},
});
