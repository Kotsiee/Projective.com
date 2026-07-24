import { define } from "@web/utils/state.ts";
import { asAuthenticatedContext } from "@projective/types/auth";
import { toWalletResponse } from "@features/wallet/core/respond.ts";
import { walletQueryFrom } from "@features/wallet/core/wallet-model.ts";
import { WalletBackendService } from "@server/services/finance/WalletBackendService.ts";

/** `GET /api/wallet/payouts` — thin route: the Payouts projection (schedule · destinations · Income Smoother · instant · history). */
export const handler = define.handlers({
	GET(ctx) {
		const context = asAuthenticatedContext(ctx.state.userContext);
		return toWalletResponse(
			WalletBackendService.payouts(walletQueryFrom(ctx.url.searchParams, context)),
		);
	},
});
