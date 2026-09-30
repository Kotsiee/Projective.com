import { define } from "@web/utils/state.ts";
import { toPaymentsResponse } from "@features/payments/core/respond.ts";
import { PaymentBackendService } from "@server/services/finance/PaymentBackendService.ts";

/**
 * `POST /api/finance/cron/deposits` — the scheduler's entry point for recurring deposits: charges every
 * `finance.deposit_rules` run that is due, off-session, through {@link PaymentBackendService}.
 *
 * Authenticated by a bearer token (`FINANCE_CRON_SECRET`, ≥ 32 characters), compared in constant time.
 * Anything else — a missing or wrong token, or no secret configured — is a 404, not a 401: an endpoint
 * that charges saved cards does not advertise that it exists. Safe to call as often as the scheduler
 * likes: a period is claimed once (`finance.claim_due_deposit_rules`) and each charge is idempotent.
 */
export const handler = define.handlers({
	async POST(ctx) {
		if (!PaymentBackendService.isCronAuthorised(ctx.req.headers.get("authorization"))) return new Response(null, { status: 404 });
		const limit = Math.min(Math.max(Number(ctx.url.searchParams.get("limit") ?? "50") || 50, 1), 200);
		return toPaymentsResponse(await PaymentBackendService.processDueDeposits(limit));
	},
});
