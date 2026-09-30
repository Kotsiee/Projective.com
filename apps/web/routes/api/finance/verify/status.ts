import { define } from "@web/utils/state.ts";
import { readActor } from "@web/utils/api-session.ts";
import { toPaymentsResponse } from "@features/payments/core/respond.ts";
import { PaymentBackendService } from "@server/services/finance/PaymentBackendService.ts";

/**
 * `GET /api/finance/verify/status` — the caller's verification picture for `/settings/verification`:
 * their own Level-2 KYC (`org.freelancer_profiles.kyc_status`, tier, payout readiness, latest identity
 * case), their personal payout account, and the Level-3 KYB (`org.business_profiles.kyb_status`) of
 * every client business they belong to. Read through `finance.my_verification_status`; statuses only.
 */
export const handler = define.handlers({
	async GET(ctx) {
		return toPaymentsResponse(await PaymentBackendService.verificationStatus(readActor(ctx)));
	},
});
