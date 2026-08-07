import { define } from "@web/utils/state.ts";
import { asAuthenticatedContext } from "@projective/types/auth";
import { invalidPayload, toCheckoutResponse } from "@features/checkout/core/respond.ts";
import {
	CardsBackendService,
	RemoveCardSchema,
} from "@server/services/finance/CardsBackendService.ts";
import { basketQueryFrom } from "@server/services/finance/basket-query.ts";

/**
 * `DELETE /api/cards/:id?owner=&persona=&workspaceRole=&acting=` — detach a card from the acting
 * account.
 *
 * Removing the default promotes the next usable card, so an account is never left with cards on file
 * and none selected. The static `/api/cards/default` route takes precedence over this wildcard, so the
 * literal id `default` is unreachable here — which is correct: it is a command, not a card.
 *
 * Thin: validate the path parameter + resolve the acting context + delegate to the fat
 * {@link CardsBackendService}. No server capability guard — the Dev Context Switcher must reach every
 * persona; the fat service enforces the member gate and the deferred `finance.saved_cards` RLS is the
 * real gate.
 */
export const handler = define.handlers({
	DELETE(ctx) {
		const context = asAuthenticatedContext(ctx.state.userContext);
		const parsed = RemoveCardSchema.safeParse({ cardId: ctx.params.id });
		if (!parsed.success) return invalidPayload(parsed.error);
		return toCheckoutResponse(
			CardsBackendService.remove(parsed.data, basketQueryFrom(ctx.url.searchParams, context)),
		);
	},
});
