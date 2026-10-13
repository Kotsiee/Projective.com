import { define } from "@web/utils/state.ts";
import { toPaymentsResponse } from "@features/payments/core/respond.ts";
import { PaymentBackendService } from "@server/services/finance/PaymentBackendService.ts";

/**
 * `POST /api/finance/cron/payouts` — the scheduler's entry point for the stale-payout sweep: every
 * withdrawal stuck in `pending` past `payout_stale_minutes` is matched to its Stripe transfer and
 * completed, re-sent under its idempotency key, or returned to the wallet, through
 * {@link PaymentBackendService} (Decision #202). Registered as the R2 job `finance-sweep-stale-payouts`.
 *
 * Authenticated by a bearer token (`FINANCE_CRON_SECRET`, ≥ 32 characters), compared in constant time.
 * Anything else — a missing or wrong token, or no secret configured — is a 404, not a 401: an endpoint
 * that sends transfers does not advertise that it exists. The body is ignored. Safe to call as often as
 * the scheduler likes: each payout is leased once per window (`finance.fn_claim_stale_payouts`) and
 * every transfer is idempotent on its payout.
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
		return toPaymentsResponse(await PaymentBackendService.sweepStalePayouts(limit));
	},
});
