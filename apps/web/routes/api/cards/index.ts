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
import { readActor } from "@web/utils/api-session.ts";

/**
 * `/api/cards` — the acting account's saved cards.
 *
 * - `GET ?owner=` — every card on file plus the one a card payment would pre-select (an entity only
 *   ever pre-selects a business card).
 * - `POST` — register a card ({@link SaveCardInputSchema}). Answered 501 until the payment processor
 *   is connected: a card row is the processor's report of an instrument it holds.
 *
 * ⚠️ **This route cannot receive a card number.** The number is collected by the processor in an
 * iframe this application does not script; only an opaque reference reaches here, and the schema has
 * no PAN or CVV field to populate. Brand, last four and expiry are the processor's to report — a
 * client that could supply them could mislabel a card.
 *
 * Thin: parse + Zod-validate + resolve the acting context and session + delegate to the fat
 * {@link CardsBackendService}, which reads as the signed-in caller — `finance.saved_cards` RLS is the
 * gate.
 */
export const handler = define.handlers({
	async GET(ctx) {
		const context = asAuthenticatedContext(ctx.state.userContext);
		return toCheckoutResponse(
			await CardsBackendService.list(basketQueryFrom(ctx.url.searchParams, context), readActor(ctx)),
		);
	},

	async POST(ctx) {
		const context = asAuthenticatedContext(ctx.state.userContext);
		const raw = await ctx.req.json().catch(() => null);
		if (raw === null || typeof raw !== "object") return malformedBody();
		const parsed = SaveCardInputSchema.safeParse(raw);
		if (!parsed.success) return invalidPayload(parsed.error);
		return toCheckoutResponse(
			await CardsBackendService.save(
				parsed.data,
				basketQueryFromBody(raw as Record<string, unknown>, context),
				readActor(ctx),
			),
		);
	},
});
