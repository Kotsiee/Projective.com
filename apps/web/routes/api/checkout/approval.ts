import { define } from "@web/utils/state.ts";
import { asAuthenticatedContext } from "@projective/types/auth";
import { CheckoutApprovalRequestSchema } from "@projective/types/finance";
import {
	invalidPayload,
	malformedBody,
	toCheckoutResponse,
} from "@features/checkout/core/respond.ts";
import { CheckoutBackendService } from "@server/services/finance/CheckoutBackendService.ts";
import { basketQueryFromBody } from "@server/services/finance/basket-query.ts";
import { readActor } from "@web/utils/api-session.ts";

/**
 * `POST /api/checkout/approval` — ask for approval of a business checkout
 * ({@link CheckoutApprovalRequestSchema}: the basket, the lines the order would pay for, and what it
 * is for, Decision #243).
 *
 * The request is bound to the basket — the approval it earns is the one this basket's next payment
 * redeems, once — and its amount is computed server-side from the named lines; the client never sends
 * one. It is the checkout's own door: a business buyer is never sent to `/spend` to ask. No money
 * moves, so there is no age gate here; the payment door that later redeems the approval has its own.
 *
 * Answers the fresh checkout session (whose spend position shows the request as pending), or a field
 * error on `reason`. Thin: parse + Zod-validate + resolve the acting context + delegate.
 */
export const handler = define.handlers({
	async POST(ctx) {
		const context = asAuthenticatedContext(ctx.state.userContext);
		const raw = await ctx.req.json().catch(() => null);
		if (raw === null || typeof raw !== "object") return malformedBody();
		const parsed = CheckoutApprovalRequestSchema.safeParse(raw);
		if (!parsed.success) return invalidPayload(parsed.error);
		return toCheckoutResponse(
			await CheckoutBackendService.requestApproval(
				parsed.data,
				basketQueryFromBody(raw as Record<string, unknown>, context),
				readActor(ctx),
			),
		);
	},
});
