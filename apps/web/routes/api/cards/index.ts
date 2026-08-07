import { define } from "@web/utils/state.ts";
import { asAuthenticatedContext } from "@projective/types/auth";
import { SaveCardInputSchema } from "@projective/types/finance";
import {
	invalidPayload,
	malformedBody,
	toCheckoutResponse,
} from "@features/checkout/core/respond.ts";
import { CardsBackendService } from "@server/services/finance/CardsBackendService.ts";
import { basketQueryFrom, basketQueryFromBody } from "@server/services/finance/basket-query.ts";

/**
 * `/api/cards` — the acting account's saved cards.
 *
 * - `GET ?owner=&persona=&workspaceRole=&acting=` — every card on file plus the one a card payment
 *   would pre-select (an entity only ever pre-selects a business card).
 * - `POST` — register a card ({@link SaveCardInputSchema}).
 *
 * ⚠️ **This route cannot receive a card number.** The number is collected by Stripe Elements in an
 * iframe this application does not script; only the resulting opaque `stripePaymentMethodId` reaches
 * here, and the schema has no PAN or CVV field to populate. Brand, last4 and expiry are resolved
 * SERVER-side rather than accepted from the caller — a client that could supply them could mislabel a
 * card.
 *
 * Thin: parse + Zod-validate + resolve the acting context + delegate to the fat
 * {@link CardsBackendService}. No server capability guard — the Dev Context Switcher must reach every
 * persona; the fat service enforces the member gate and the business-card scope rule, and the deferred
 * `finance.saved_cards` RLS is the real gate.
 */
export const handler = define.handlers({
	GET(ctx) {
		const context = asAuthenticatedContext(ctx.state.userContext);
		return toCheckoutResponse(
			CardsBackendService.list(basketQueryFrom(ctx.url.searchParams, context)),
		);
	},

	async POST(ctx) {
		const context = asAuthenticatedContext(ctx.state.userContext);
		const raw = await ctx.req.json().catch(() => null);
		if (raw === null || typeof raw !== "object") return malformedBody();
		const parsed = SaveCardInputSchema.safeParse(raw);
		if (!parsed.success) return invalidPayload(parsed.error);
		return toCheckoutResponse(
			CardsBackendService.save(
				parsed.data,
				basketQueryFromBody(raw as Record<string, unknown>, context),
			),
		);
	},
});
