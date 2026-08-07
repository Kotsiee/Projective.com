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

/**
 * `POST /api/cards/default` — make one card the acting account's default
 * ({@link SetDefaultCardSchema}).
 *
 * An expired card is refused rather than silently accepted: a default that cannot be charged is a
 * checkout that fails at the last step for a reason the buyer was never shown.
 *
 * Thin: parse + Zod-validate + resolve the acting context + delegate to the fat
 * {@link CardsBackendService}. No server capability guard — the Dev Context Switcher must reach every
 * persona; the fat service enforces the member gate and the deferred `finance.saved_cards` RLS is the
 * real gate.
 */
export const handler = define.handlers({
	async POST(ctx) {
		const context = asAuthenticatedContext(ctx.state.userContext);
		const raw = await ctx.req.json().catch(() => null);
		if (raw === null || typeof raw !== "object") return malformedBody();
		const parsed = SetDefaultCardSchema.safeParse(raw);
		if (!parsed.success) return invalidPayload(parsed.error);
		return toCheckoutResponse(
			CardsBackendService.setDefault(
				parsed.data,
				basketQueryFromBody(raw as Record<string, unknown>, context),
			),
		);
	},
});
