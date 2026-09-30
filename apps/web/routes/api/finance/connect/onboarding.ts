import { define } from "@web/utils/state.ts";
import { ConnectOnboardingInputSchema } from "@projective/types/finance";
import { readActor } from "@web/utils/api-session.ts";
import { invalidBody, readJson, toPaymentsResponse } from "@features/payments/core/respond.ts";
import { PaymentBackendService } from "@server/services/finance/PaymentBackendService.ts";

/**
 * `POST /api/finance/connect/onboarding` — start or resume Stripe-hosted payout onboarding.
 *
 * Thin by contract: Zod-validate and delegate. The fat {@link PaymentBackendService} resolves whose
 * account it is (`finance.payout_account_for` — the caller, or a team they hold `manage_billing` on),
 * creates the Stripe Connect account on first use (Accounts v2, Express dashboard, recipient
 * configuration), records it, and answers with a fresh single-use onboarding URL for the browser to
 * open. The account becomes payable only when Stripe reports its transfers capability active.
 *
 * Body: `{ scope: "personal" | "team", teamId?, country }` — `country` (ISO alpha-2) is fixed by
 * Stripe at creation and ignored when the owner already has an account.
 */
export const handler = define.handlers({
	async POST(ctx) {
		const parsed = ConnectOnboardingInputSchema.safeParse(await readJson(ctx.req));
		if (!parsed.success) return invalidBody(parsed.error);
		return toPaymentsResponse(
			await PaymentBackendService.startConnectOnboarding(parsed.data, readActor(ctx)),
		);
	},
});
