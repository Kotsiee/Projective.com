import { define } from "@web/utils/state.ts";
import { toPaymentsResponse } from "@features/payments/core/respond.ts";
import { PaymentBackendService } from "@server/services/finance/PaymentBackendService.ts";

/**
 * `POST /api/finance/cron/payout-schedules` — the scheduler's entry point for payout schedules
 * (Decision #337, ruling M6): every due weekly, monthly or threshold schedule is paid out as a
 * withdrawal by its author and its Stripe Transfer sent, through {@link PaymentBackendService}.
 * Registered as the job `finance-payout-schedules`. The stale-payout sweep is `cron/payouts`.
 *
 * Authenticated by a bearer token (`FINANCE_CRON_SECRET`, ≥ 32 characters), compared in constant time.
 * Anything else — a missing or wrong token, or no secret configured — is a 404, not a 401: an endpoint
 * that sends transfers does not advertise that it exists. The body is ignored. Safe to call as often as
 * the scheduler likes: each schedule is claimed under SKIP LOCKED and advanced in the claim, and every
 * Transfer is idempotent on its payout.
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
		return toPaymentsResponse(await PaymentBackendService.runPayoutSchedules(limit));
	},
});
