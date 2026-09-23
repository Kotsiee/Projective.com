import { define } from "@web/utils/state.ts";
import { asAuthenticatedContext } from "@projective/types/auth";
import {
	invalidPayload,
	malformedBody,
	toCheckoutResponse,
} from "@features/checkout/core/respond.ts";
import {
	CardsBackendService,
	SetDefaultCardSchema,
} from "@server/services/finance/CardsBackendService.ts";
import { basketQueryFromBody } from "@server/services/finance/basket-query.ts";
import { readActor } from "@web/utils/api-session.ts";

/**
 * `POST /api/cards/default` — make one card the acting account's default
 * ({@link SetDefaultCardSchema}).
 *
 * An expired card is refused rather than silently accepted: a default that cannot be charged is a
 * checkout that fails at the last step for a reason the buyer was never shown.
 *
 * Thin: parse + Zod-validate + resolve the acting context and session + delegate to the fat
 * {@link CardsBackendService}, which writes as the signed-in caller — the `finance.saved_cards` RLS
 * (`manage_billing` for an entity) is the gate.
 */
export const handler = define.handlers({
	async POST(ctx) {
		const context = asAuthenticatedContext(ctx.state.userContext);
		const raw = await ctx.req.json().catch(() => null);
		if (raw === null || typeof raw !== "object") return malformedBody();
		const parsed = SetDefaultCardSchema.safeParse(raw);
		if (!parsed.success) return invalidPayload(parsed.error);
		return toCheckoutResponse(
			await CardsBackendService.setDefault(
				parsed.data,
				basketQueryFromBody(raw as Record<string, unknown>, context),
				readActor(ctx),
			),
		);
	},
});
