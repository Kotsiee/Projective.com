import { define } from "@web/utils/state.ts";
import { asAuthenticatedContext } from "@projective/types/auth";
import { CreateCheckoutSchema } from "@projective/types/finance";
import {
	invalidPayload,
	malformedBody,
	toCheckoutResponse,
} from "@features/checkout/core/respond.ts";
import { CheckoutBackendService } from "@server/services/finance/CheckoutBackendService.ts";
import { basketQueryFromBody } from "@server/services/finance/basket-query.ts";

/**
 * `POST /api/checkout/create` — charge a checkout ({@link CreateCheckoutSchema}).
 *
 * The payload names the exact lines being paid for (so a basket changed in another tab cannot widen the
 * charge), the provider, the card for a card payment, the total the buyer was SHOWN, and a
 * client-minted `idempotencyKey`.
 *
 * Two protections live in the fat service, not here: the attempt is **idempotent** on that key, so a
 * double-click or a retry after a dropped response replays the stored outcome instead of charging
 * twice; and `expectedTotalMinor` is **re-verified** against a freshly computed total, refusing on
 * mismatch — a client-supplied total the server accepts blindly is a price-tampering hole.
 *
 * The route always answers `200` with a {@link CheckoutResult}: a refusal is an OUTCOME the surface
 * renders (status · message · blockers), not a transport error. Thin: parse + Zod-validate (mapping
 * issues to field errors) + resolve the acting context + delegate. No server capability guard — the Dev
 * Context Switcher must reach every persona; the fat service enforces the member gate, the verification
 * gate, the provider rules and the instrument checks, and the deferred `finance.*` RLS is the real gate.
 */
export const handler = define.handlers({
	async POST(ctx) {
		const context = asAuthenticatedContext(ctx.state.userContext);
		const raw = await ctx.req.json().catch(() => null);
		if (raw === null || typeof raw !== "object") return malformedBody();
		const parsed = CreateCheckoutSchema.safeParse(raw);
		if (!parsed.success) return invalidPayload(parsed.error);
		return toCheckoutResponse(
			CheckoutBackendService.create(
				parsed.data,
				basketQueryFromBody(raw as Record<string, unknown>, context),
			),
		);
	},
});
