import { define } from "@web/utils/state.ts";
import { asAuthenticatedContext } from "@projective/types/auth";
import { readActor } from "@web/utils/api-session.ts";
import { toWalletResponse } from "@features/wallet/core/respond.ts";
import { walletQueryFrom } from "@features/wallet/core/wallet-model.ts";
import { WalletBackendService } from "@server/services/finance/WalletBackendService.ts";

/** `GET /api/wallet/payouts` — thin route: the Payouts projection (schedule · destinations · Income Smoother · history), read as the signed-in viewer. */
export const handler = define.handlers({
	async GET(ctx) {
		const context = asAuthenticatedContext(ctx.state.userContext);
		return toWalletResponse(
			await WalletBackendService.payouts(walletQueryFrom(ctx.url.searchParams, context), readActor(ctx)),
		);
	},
});
