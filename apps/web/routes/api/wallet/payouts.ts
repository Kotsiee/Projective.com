import { define } from "@web/utils/state.ts";
import { asAuthenticatedContext } from "@projective/types/auth";
import { WithdrawInputSchema } from "@projective/types/finance";
import { readActor } from "@web/utils/api-session.ts";
import { toFieldErrors, toWalletResponse } from "@features/wallet/core/respond.ts";
import { walletQueryFrom } from "@features/wallet/core/wallet-model.ts";
import { WalletBackendService } from "@server/services/finance/WalletBackendService.ts";

/**
 * `/api/wallet/payouts` — thin route.
 *
 * - `GET` — the Payouts projection (schedule · destinations · Income Smoother · history), read as the
 *   signed-in viewer.
 * - `POST` — withdraw (`WithdrawInputSchema`): the same action `POST /api/wallet/action` with
 *   `action: "withdraw"` runs, addressed by its own resource. The fat {@link WalletBackendService}
 *   debits the wallet through `finance.begin_payout` (which applies the KYC/KYB gates and requires a
 *   verified payout account) and sends the Stripe Transfer; this route only parses and validates.
 */
export const handler = define.handlers({
	async GET(ctx) {
		const context = asAuthenticatedContext(ctx.state.userContext);
		return toWalletResponse(
			await WalletBackendService.payouts(walletQueryFrom(ctx.url.searchParams, context), readActor(ctx)),
		);
	},

	async POST(ctx) {
		const actor = readActor(ctx);
		if (!actor.userId) {
			return Response.json({ ok: false, message: "Sign in to withdraw." }, { status: 401 });
		}
		const body = await ctx.req.json().catch(() => null);
		const parsed = WithdrawInputSchema.safeParse(body);
		if (!parsed.success) {
			return Response.json(
				{ ok: false, message: "Check the highlighted fields.", errors: toFieldErrors(parsed.error) },
				{ status: 422 },
			);
		}
		const base = walletQueryFrom(ctx.url.searchParams, asAuthenticatedContext(ctx.state.userContext));
		return toWalletResponse(
			await WalletBackendService.withdraw(
				parsed.data,
				{ ...base, display: parsed.data.display ?? base.display },
				actor,
			),
		);
	},
});
