import { define } from "@web/utils/state.ts";
import { toPaymentsResponse } from "@features/payments/core/respond.ts";
import { PaymentBackendService } from "@server/services/finance/PaymentBackendService.ts";

/**
 * `POST /api/finance/cron/tax` — the scheduler's entry point for the tax sweep (Decision #490, CK4):
 * the Stripe tax transaction of each order placed on a Stripe Tax calculation, and the reversal of each
 * refunded line's tax, through {@link PaymentBackendService}. Registered as the R2 job
 * `finance-tax-records`. Nothing is due while `tax_collection_enabled` is off.
 *
 * Authenticated by a bearer token (`FINANCE_CRON_SECRET`), compared in constant time; anything else is a
 * 404, as the payout sweep's route is. Safe to call as often as the scheduler likes: each record is
 * idempotent at Stripe on its order or line and written once.
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
		return toPaymentsResponse(await PaymentBackendService.sweepTaxRecords(limit));
	},
});
