import { define } from "@web/utils/state.ts";
import { readActor } from "@web/utils/api-session.ts";
import { toPaymentsResponse } from "@features/payments/core/respond.ts";
import { DevVerificationBackendService } from "@server/services/finance/DevVerificationBackendService.ts";

/**
 * `POST /api/finance/verify/force` — DEVELOPMENT ONLY. Make the signed-in freelancer Stripe
 * identity-verified and payout-ready (the Decision #196 earning gate) from the Dev Tools Context
 * Switcher, without a trip through Stripe. Answers the caller's verification picture afterwards.
 *
 * The gate is the SERVER's `DENO_ENV`, read inside the fat
 * {@link DevVerificationBackendService.forcePayoutReady}, which answers a plain 404 anywhere but
 * development; the Dev Tools island that calls this is itself absent from a production bundle.
 */
export const handler = define.handlers({
	async POST(ctx) {
		return toPaymentsResponse(await DevVerificationBackendService.forcePayoutReady(readActor(ctx)));
	},
});
