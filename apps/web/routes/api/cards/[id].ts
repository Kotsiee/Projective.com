import { define } from "@web/utils/state.ts";
import { asAuthenticatedContext } from "@projective/types/auth";
import { invalidPayload, toCheckoutResponse } from "@features/checkout/core/respond.ts";
import {
	CardsBackendService,
	RemoveCardSchema,
} from "@server/services/finance/CardsBackendService.ts";
import { basketQueryFrom } from "@server/services/finance/basket-query.ts";
import { readActor } from "@web/utils/api-session.ts";

/**
 * `DELETE /api/cards/:id?owner=` — remove a card from the acting account.
 *
 * Removing the default promotes the next usable card, so an account is never left with cards on file
 * and none selected. The static `/api/cards/default` route takes precedence over this wildcard, so the
 * literal id `default` is unreachable here — which is correct: it is a command, not a card.
 *
 * Thin: validate the path parameter + resolve the acting context and session + delegate to the fat
 * {@link CardsBackendService}, which writes as the signed-in caller — the `finance.saved_cards` RLS
 * (`manage_billing` for an entity) is the gate.
 */
export const handler = define.handlers({
	async DELETE(ctx) {
		const context = asAuthenticatedContext(ctx.state.userContext);
		const parsed = RemoveCardSchema.safeParse({ cardId: ctx.params.id });
		if (!parsed.success) return invalidPayload(parsed.error);
		return toCheckoutResponse(
			await CardsBackendService.remove(
				parsed.data,
				basketQueryFrom(ctx.url.searchParams, context),
				readActor(ctx),
			),
		);
	},
});
