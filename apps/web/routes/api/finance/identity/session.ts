import { define } from "@web/utils/state.ts";
import { readActor } from "@web/utils/api-session.ts";
import { toPaymentsResponse } from "@features/payments/core/respond.ts";
import { PaymentBackendService } from "@server/services/finance/PaymentBackendService.ts";

/**
 * `POST /api/finance/identity/session` — start a Stripe Identity check (government ID captured live
 * plus a matching selfie) for the calling freelancer: the Level-2 KYC half of the earning gate.
 *
 * No body — whose check it is comes from the session, never from a request field. The fat
 * {@link PaymentBackendService} opens a `finance.verification_cases` row (freelancers only, bounded per
 * day in the database because every check is billed), creates the verification session and answers
 * with its hosted `url` and Stripe.js `clientSecret`. The DECISION arrives only through the signed
 * `identity.verification_session.*` webhook.
 */
export const handler = define.handlers({
	async POST(ctx) {
		return toPaymentsResponse(await PaymentBackendService.createIdentitySession(readActor(ctx)));
	},
});
