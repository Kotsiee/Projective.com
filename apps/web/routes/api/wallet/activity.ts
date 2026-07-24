import { define } from "@web/utils/state.ts";
import { asAuthenticatedContext } from "@projective/types/auth";
import { toWalletResponse } from "@features/wallet/core/respond.ts";
import { toActivityRange, walletQueryFrom } from "@features/wallet/core/wallet-model.ts";
import { WalletBackendService } from "@server/services/finance/WalletBackendService.ts";

/**
 * `GET /api/wallet/activity?range=30d|90d|12m` — thin route: the Activity charts projection (in-vs-out,
 * by-category, by-project, role-specific series) for the active wallet.
 */
export const handler = define.handlers({
	GET(ctx) {
		const context = asAuthenticatedContext(ctx.state.userContext);
		const range = toActivityRange(ctx.url.searchParams.get("range"));
		return toWalletResponse(
			WalletBackendService.activity(walletQueryFrom(ctx.url.searchParams, context), range),
		);
	},
});
