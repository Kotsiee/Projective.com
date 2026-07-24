import { define } from "@web/utils/state.ts";
import { asAuthenticatedContext } from "@projective/types/auth";
import { walletQueryFrom } from "@features/wallet/core/wallet-model.ts";
import { WalletBackendService } from "@server/services/finance/WalletBackendService.ts";

/**
 * `GET /api/wallet/overview?w=&display=&vaultRole=&kyc=&smoother=&fundMix=` — thin route: resolve the
 * acting context + the wallet/display/dev-simulation query, then delegate to the fat
 * {@link WalletBackendService} for the Overview projection AND the wallet switcher (the page + the lane
 * both need a fresh switcher after a currency/wallet change). No server capability guard — the Dev
 * Context Switcher (client-side) must reach every wallet/role; wallet-ness is chrome + deferred RLS.
 */
export const handler = define.handlers({
	GET(ctx) {
		const context = asAuthenticatedContext(ctx.state.userContext);
		const query = walletQueryFrom(ctx.url.searchParams, context);
		const ov = WalletBackendService.overview(query);
		const sw = WalletBackendService.switcher(query);
		if (!ov.ok || !ov.data || !sw.ok || !sw.data) {
			return Response.json({ ok: false, message: "Couldn't load the wallet." }, { status: 500 });
		}
		return Response.json({
			ok: true,
			data: { overview: ov.data.overview, switcher: sw.data.switcher },
		});
	},
});
