import { define } from "@web/utils/state.ts";
import { asAuthenticatedContext } from "@projective/types/auth";
import { readActor } from "@web/utils/api-session.ts";
import { toWalletResponse } from "@features/wallet/core/respond.ts";
import { toActivityRange, walletQueryFrom } from "@features/wallet/core/wallet-model.ts";
import { WalletBackendService } from "@server/services/finance/WalletBackendService.ts";

/**
 * `GET /api/wallet/activity?range=30d|90d|12m` — thin route: the Activity charts projection (in-vs-out,
 * by-category, by-project, role-specific series) for the active wallet, read as the signed-in viewer.
 */
export const handler = define.handlers({
	async GET(ctx) {
		const context = asAuthenticatedContext(ctx.state.userContext);
		const range = toActivityRange(ctx.url.searchParams.get("range"));
		return toWalletResponse(
			await WalletBackendService.activity(walletQueryFrom(ctx.url.searchParams, context), range, readActor(ctx)),
		);
	},
});
