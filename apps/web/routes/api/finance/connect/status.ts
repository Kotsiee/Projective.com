import { define } from "@web/utils/state.ts";
import { PayoutAccountScopeSchema } from "@projective/types/finance";
import { readActor } from "@web/utils/api-session.ts";
import { toFieldErrors, toPaymentsResponse } from "@features/payments/core/respond.ts";
import { PaymentBackendService } from "@server/services/finance/PaymentBackendService.ts";

/**
 * `GET /api/finance/connect/status?scope=personal|team|business&teamId=…&businessId=…[&sync=1]` —
 * where a payout account stands: not started, pending verification, verified (payable), restricted or
 * disabled. For a business it is the Level-3 KYB account.
 *
 * Without `sync` it answers from the ledger's own record; with `sync=1` the fat
 * {@link PaymentBackendService} re-reads the account from Stripe first and applies a changed status.
 */
export const handler = define.handlers({
	async GET(ctx) {
		const q = ctx.url.searchParams;
		const owner = PayoutAccountScopeSchema.safeParse({
			scope: q.get("scope") ?? "personal",
			teamId: q.get("teamId"),
			businessId: q.get("businessId"),
		});
		if (!owner.success) {
			return Response.json(
				{ ok: false, message: "Check the highlighted fields.", errors: toFieldErrors(owner.error) },
				{ status: 422, headers: { "cache-control": "no-store" } },
			);
		}
		const sync = q.get("sync") === "1" || q.get("sync") === "true";
		return toPaymentsResponse(
			await PaymentBackendService.connectStatus(owner.data, readActor(ctx), { sync }),
		);
	},
});
