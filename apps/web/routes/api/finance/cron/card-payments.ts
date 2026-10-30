import { define } from "@web/utils/state.ts";
import { toPaymentsResponse } from "@features/payments/core/respond.ts";
import { PaymentBackendService } from "@server/services/finance/PaymentBackendService.ts";

/**
 * `POST /api/finance/cron/card-payments` — the scheduler's entry point for the card-payment recovery
 * sweep (FINANCE_COMPLETENESS_AUDIT N1): every card payment still unsettled past its grace period is
 * looked up at Stripe and, when its intent succeeded, credited through the webhook's own door by
 * {@link PaymentBackendService}. Scheduled as `finance-sweep-card-payments` every 15 minutes
 * (`00005060`).
 *
 * Authenticated by a bearer token (`FINANCE_CRON_SECRET`, ≥ 32 characters), compared in constant time.
 * Anything else — a missing or wrong token, or no secret configured — is a 404, not a 401. The body is
 * ignored. Safe to call as often as the scheduler likes: each payment is leased once per window
 * (`finance.claim_unsettled_card_payments`) and every settlement is idempotent on its intent.
 */
export const handler = define.handlers({
	async POST(ctx) {
		if (!PaymentBackendService.isCronAuthorised(ctx.req.headers.get("authorization"))) {
			return new Response(null, { status: 404 });
		}
		const limit = Math.min(
			Math.max(Number(ctx.url.searchParams.get("limit") ?? "50") || 50, 1),
			200,
		);
		return toPaymentsResponse(await PaymentBackendService.sweepUnsettledCardPayments(limit));
	},
});
