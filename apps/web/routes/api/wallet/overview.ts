import { define } from "@web/utils/state.ts";
import { asAuthenticatedContext } from "@projective/types/auth";
import { readActor } from "@web/utils/api-session.ts";
import { toWalletResponse } from "@features/wallet/core/respond.ts";
import { walletQueryFrom } from "@features/wallet/core/wallet-model.ts";
import { WalletBackendService } from "@server/services/finance/WalletBackendService.ts";

/**
 * `GET /api/wallet/overview?w=&display=` — thin route: the Overview projection AND the wallet switcher
 * from one resolution of the viewer's wallets (the page and the lane both need a fresh switcher after
 * a currency or account change). Read as the signed-in viewer; `finance.*` RLS is the gate, and a
 * guest gets a 401 rather than a wallet.
 */
export const handler = define.handlers({
	async GET(ctx) {
		const context = asAuthenticatedContext(ctx.state.userContext);
		return toWalletResponse(
			await WalletBackendService.overviewWithSwitcher(walletQueryFrom(ctx.url.searchParams, context), readActor(ctx)),
		);
	},
});
