import { define } from "@web/utils/state.ts";
import { asAuthenticatedContext } from "@projective/types/auth";
import { readActor } from "@web/utils/api-session.ts";
import { TransactionListParamsSchema } from "@projective/types/finance";
import { toFieldErrors, toWalletResponse } from "@features/wallet/core/respond.ts";
import { ledgerApiParamsFrom, walletQueryFrom } from "@features/wallet/core/wallet-model.ts";
import { WalletBackendService } from "@server/services/finance/WalletBackendService.ts";

/**
 * `GET /api/wallet/transactions?…filters…` — thin route: parse the ledger filters (search · direction ·
 * line families · the ruler's range · date range · sort · keyset cursor · limit), Zod-check them, then
 * delegate to the fat {@link WalletBackendService.transactions}. Islands never reach the backend — they
 * fetch this via the dumb `WalletService`. A malformed filter is a 400 that names the field, never a
 * silently unfiltered ledger.
 */
export const handler = define.handlers({
	async GET(ctx) {
		const context = asAuthenticatedContext(ctx.state.userContext);
		const sp = ctx.url.searchParams;
		const parsed = TransactionListParamsSchema.safeParse(ledgerApiParamsFrom(sp));
		if (!parsed.success) {
			return Response.json({
				ok: false,
				message: "Those filters couldn't be read.",
				errors: toFieldErrors(parsed.error),
			}, { status: 400 });
		}
		return toWalletResponse(
			await WalletBackendService.transactions(
				walletQueryFrom(sp, context),
				parsed.data,
				readActor(ctx),
			),
		);
	},
});
