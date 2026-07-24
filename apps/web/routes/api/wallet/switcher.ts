import { define } from "@web/utils/state.ts";
import { asAuthenticatedContext } from "@projective/types/auth";
import { toWalletResponse } from "@features/wallet/core/respond.ts";
import { walletQueryFrom } from "@features/wallet/core/wallet-model.ts";
import { WalletBackendService } from "@server/services/finance/WalletBackendService.ts";

/**
 * `GET /api/wallet/switcher` — thin route: the wallet switcher (active wallet · accounts · aggregate) in
 * the viewer's display currency. Used by the lane island to refresh the switcher after a currency change.
 */
export const handler = define.handlers({
	GET(ctx) {
		const context = asAuthenticatedContext(ctx.state.userContext);
		return toWalletResponse(
			WalletBackendService.switcher(walletQueryFrom(ctx.url.searchParams, context)),
		);
	},
});
