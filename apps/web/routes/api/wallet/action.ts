import { define } from "@web/utils/state.ts";
import { asAuthenticatedContext } from "@projective/types/auth";
import {
	AddMethodInputSchema,
	DepositRuleInputSchema,
	DistributeInputSchema,
	FundEscrowInputSchema,
	IncomeSmootherEnrolInputSchema,
	PayoutScheduleInputSchema,
	SpendDecisionInputSchema,
	SpendRequestInputSchema,
	TopUpInputSchema,
	TransferInputSchema,
	WithdrawInputSchema,
} from "@projective/types/finance";
import type { WalletQuery } from "@projective/types/finance";
import { readActor } from "@web/utils/api-session.ts";
import { toFieldErrors, toWalletResponse } from "@features/wallet/core/respond.ts";
import { walletQueryFrom } from "@features/wallet/core/wallet-model.ts";
import { WalletBackendService } from "@server/services/finance/WalletBackendService.ts";
import type { ServiceResult } from "@server/services/ServiceResult.ts";

/**
 * `POST /api/wallet/action` — the single thin route for every money action, discriminated by the
 * `action` field. It Zod-validates the matching payload (mapping issues to field errors) and delegates
 * to the fat {@link WalletBackendService}, which performs the action AS the signed-in caller: the
 * movements run through definer functions that authorise the caller themselves, the settings through
 * `finance.*` RLS. This route only parses, validates and forwards — it holds no money logic and no
 * capability guard of its own.
 */

/** A 422 with field errors from a failed parse. */
function invalid(error: Parameters<typeof toFieldErrors>[0]): Response {
	return Response.json(
		{ ok: false, message: "Check the highlighted fields.", errors: toFieldErrors(error) },
		{ status: 422 },
	);
}

export const handler = define.handlers({
	async POST(ctx) {
		const body = await ctx.req.json().catch(() => null) as Record<string, unknown> | null;
		if (!body || typeof body.action !== "string") {
			return Response.json({ ok: false, message: "Missing action." }, { status: 400 });
		}
		const context = asAuthenticatedContext(ctx.state.userContext);
		const actor = readActor(ctx);
		if (!actor.userId) {
			return Response.json({ ok: false, message: "Sign in to use your wallet." }, { status: 401 });
		}
		// The refreshed Overview each action answers with is drawn in the currency the caller is viewing.
		const base = walletQueryFrom(ctx.url.searchParams, context);
		const query = (display: string | undefined): WalletQuery => ({ ...base, display: display ?? base.display });

		let result: ServiceResult<{ result: unknown }>;
		switch (body.action) {
			case "top_up": {
				const p = TopUpInputSchema.safeParse(body);
				if (!p.success) return invalid(p.error);
				result = await WalletBackendService.topUp(p.data);
				break;
			}
			case "withdraw": {
				const p = WithdrawInputSchema.safeParse(body);
				if (!p.success) return invalid(p.error);
				result = await WalletBackendService.withdraw(p.data);
				break;
			}
			case "transfer": {
				const p = TransferInputSchema.safeParse(body);
				if (!p.success) return invalid(p.error);
				result = await WalletBackendService.transfer(p.data, query(p.data.display), actor);
				break;
			}
			case "distribute": {
				const p = DistributeInputSchema.safeParse(body);
				if (!p.success) return invalid(p.error);
				result = await WalletBackendService.distribute(p.data, query(p.data.display), actor);
				break;
			}
			case "fund_escrow": {
				const p = FundEscrowInputSchema.safeParse(body);
				if (!p.success) return invalid(p.error);
				result = await WalletBackendService.fundEscrow(p.data, query(p.data.display), actor);
				break;
			}
			case "new_recurring": {
				const p = DepositRuleInputSchema.safeParse(body);
				if (!p.success) return invalid(p.error);
				result = await WalletBackendService.addRecurring(p.data);
				break;
			}
			case "add_method": {
				const p = AddMethodInputSchema.safeParse(body);
				if (!p.success) return invalid(p.error);
				result = await WalletBackendService.addMethod(p.data);
				break;
			}
			case "set_payout": {
				const p = PayoutScheduleInputSchema.safeParse(body);
				if (!p.success) return invalid(p.error);
				result = await WalletBackendService.setPayout(p.data, query(p.data.display), actor);
				break;
			}
			case "request_spend": {
				const p = SpendRequestInputSchema.safeParse(body);
				if (!p.success) return invalid(p.error);
				result = await WalletBackendService.requestSpend(p.data, query(p.data.display), actor);
				break;
			}
			case "spend_decision": {
				const p = SpendDecisionInputSchema.safeParse(body);
				if (!p.success) return invalid(p.error);
				result = await WalletBackendService.decideSpend(p.data, query(p.data.display), actor);
				break;
			}
			case "enrol_smoother": {
				const p = IncomeSmootherEnrolInputSchema.safeParse(body);
				if (!p.success) return invalid(p.error);
				result = await WalletBackendService.enrolSmoother(p.data);
				break;
			}
			default:
				return Response.json({ ok: false, message: "Unknown action." }, { status: 400 });
		}
		return toWalletResponse(result);
	},
});
