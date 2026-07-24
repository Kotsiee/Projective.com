import { define } from "@web/utils/state.ts";
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
import { toFieldErrors, toWalletResponse } from "@features/wallet/core/respond.ts";
import { parseSim } from "@features/wallet/core/wallet-model.ts";
import { WalletBackendService } from "@server/services/finance/WalletBackendService.ts";
import type { WalletSim } from "@projective/types/finance";
import type { ServiceResult } from "@server/services/ServiceResult.ts";

/**
 * `POST /api/wallet/action` — the single thin route for every money mutation, discriminated by the
 * `action` field. It Zod-validates the matching payload (mapping issues to field errors), reads the
 * dev-simulation knobs from the body (so the refreshed overview reflects the switcher), then delegates
 * to the fat {@link WalletBackendService}. All money math is the service's; this route only parses,
 * validates, and guards.
 *
 * No server capability guard — the Dev Context Switcher must be able to act as any simulated role; the
 * fat service enforces the affordability / eligibility checks and the deferred `finance.*` RLS is the
 * real gate (consistent with every sibling `/api/*` mutation).
 */

/** Read the dev-simulation knobs from the POST body (the same 4 string fields the query carries). */
function simFromBody(body: Record<string, unknown>): WalletSim | undefined {
	const sp = new URLSearchParams();
	for (const k of ["vaultRole", "kyc", "smoother", "fundMix"]) {
		const v = body[k];
		if (typeof v === "string") sp.set(k, v);
	}
	return parseSim(sp);
}

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
		const sim = simFromBody(body);
		const action = body.action;

		let result: ServiceResult<{ result: unknown }>;
		switch (action) {
			case "top_up": {
				const p = TopUpInputSchema.safeParse(body);
				if (!p.success) return invalid(p.error);
				result = WalletBackendService.topUp(p.data, sim);
				break;
			}
			case "withdraw": {
				const p = WithdrawInputSchema.safeParse(body);
				if (!p.success) return invalid(p.error);
				result = WalletBackendService.withdraw(p.data, sim);
				break;
			}
			case "transfer": {
				const p = TransferInputSchema.safeParse(body);
				if (!p.success) return invalid(p.error);
				result = WalletBackendService.transfer(p.data, sim);
				break;
			}
			case "distribute": {
				const p = DistributeInputSchema.safeParse(body);
				if (!p.success) return invalid(p.error);
				result = WalletBackendService.distribute(p.data, sim);
				break;
			}
			case "fund_escrow": {
				const p = FundEscrowInputSchema.safeParse(body);
				if (!p.success) return invalid(p.error);
				result = WalletBackendService.fundEscrow(p.data, sim);
				break;
			}
			case "new_recurring": {
				const p = DepositRuleInputSchema.safeParse(body);
				if (!p.success) return invalid(p.error);
				result = WalletBackendService.addRecurring(p.data, sim);
				break;
			}
			case "add_method": {
				const p = AddMethodInputSchema.safeParse(body);
				if (!p.success) return invalid(p.error);
				result = WalletBackendService.addMethod(p.data, sim);
				break;
			}
			case "set_payout": {
				const p = PayoutScheduleInputSchema.safeParse(body);
				if (!p.success) return invalid(p.error);
				result = WalletBackendService.setPayout(p.data, sim);
				break;
			}
			case "request_spend": {
				const p = SpendRequestInputSchema.safeParse(body);
				if (!p.success) return invalid(p.error);
				result = WalletBackendService.requestSpend(p.data, sim);
				break;
			}
			case "spend_decision": {
				const p = SpendDecisionInputSchema.safeParse(body);
				if (!p.success) return invalid(p.error);
				result = WalletBackendService.decideSpend(p.data, sim);
				break;
			}
			case "enrol_smoother": {
				const p = IncomeSmootherEnrolInputSchema.safeParse(body);
				if (!p.success) return invalid(p.error);
				result = WalletBackendService.enrolSmoother(p.data, sim);
				break;
			}
			default:
				return Response.json({ ok: false, message: "Unknown action." }, { status: 400 });
		}
		return toWalletResponse(result);
	},
});
