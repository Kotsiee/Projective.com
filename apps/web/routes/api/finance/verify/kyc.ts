import { define } from "@web/utils/state.ts";
import { readActor } from "@web/utils/api-session.ts";
import { toPaymentsResponse } from "@features/payments/core/respond.ts";
import { PaymentBackendService } from "@server/services/finance/PaymentBackendService.ts";

/**
 * `POST /api/finance/verify/kyc` — start the freelancer Level-2 KYC check (Stripe Identity: a government
 * ID captured live plus a matching selfie) from `/settings/verification`, returning there afterwards.
 *
 * The same fat call as `POST /api/finance/identity/session` (which returns to the wallet): whose check
 * it is comes from the session, never a request field; the DECISION arrives only through the signed
 * `identity.verification_session.*` webhook.
 */
export const handler = define.handlers({
	async POST(ctx) {
		return toPaymentsResponse(
			await PaymentBackendService.createIdentitySession(readActor(ctx), {
				returnPath: "/settings/verification",
			}),
		);
	},
});
