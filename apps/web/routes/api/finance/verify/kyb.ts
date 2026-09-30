import { define } from "@web/utils/state.ts";
import { KybOnboardingInputSchema } from "@projective/types/finance";
import { readActor } from "@web/utils/api-session.ts";
import { invalidBody, readJson, toPaymentsResponse } from "@features/payments/core/respond.ts";
import { PaymentBackendService } from "@server/services/finance/PaymentBackendService.ts";

/**
 * `POST /api/finance/verify/kyb` — start (or resume) the Level-3 KYB check for a client business:
 * Stripe Connect onboarding for the business's own account (Accounts v2, Express dashboard). Only a
 * member with `manage_billing` on the business may (`finance.payout_account_for`, scope `business`).
 * A verified account marks the business KYB-verified (`finance.sync_payout_account`); the hosted flow
 * returns to `/settings/verification`.
 *
 * Body: `{ businessId, country }` — `country` (ISO alpha-2) is where the business is registered, fixed
 * by Stripe at account creation.
 */
export const handler = define.handlers({
	async POST(ctx) {
		const parsed = KybOnboardingInputSchema.safeParse(await readJson(ctx.req));
		if (!parsed.success) return invalidBody(parsed.error);
		return toPaymentsResponse(await PaymentBackendService.startKybOnboarding(parsed.data, readActor(ctx)));
	},
});
