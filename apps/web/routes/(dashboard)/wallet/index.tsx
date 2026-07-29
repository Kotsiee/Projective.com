import { page } from "fresh";
import { asAuthenticatedContext } from "@projective/types/auth";
import { define } from "@web/utils/state.ts";
import WalletOverviewScreen from "@features/wallet/islands/WalletOverviewScreen.island.tsx";
import { resolveMethods, resolveWalletOverview } from "@features/wallet/core/wallet-ssr.ts";
import { defaultWalletParam } from "@features/wallet/core/wallet-model.ts";

/**
 * `/wallet` — the context-scoped Wallet overview hub. Thin controller: the guest bounce is the
 * `(dashboard)` middleware's job; the wallet is resolved from the active context (or the `?w=`
 * switcher override) so the correct personal/team/business face SSR-paints in the first byte.
 *
 * The overview, the switcher and the saved payment methods are resolved together because the hero
 * band needs all three in its first paint — the balance identity, the account it belongs to, and the
 * card deck beside it. No hard capability guard: the wallet is chrome plus deferred `finance.*` RLS,
 * like every sibling read.
 */
export const handler = define.handlers({
	GET(ctx) {
		const context = asAuthenticatedContext(ctx.state.userContext);
		const { overview, switcher } = resolveWalletOverview(context, ctx.url);
		const methods = resolveMethods(context, ctx.url);
		const wallet = ctx.url.searchParams.get("w") ?? defaultWalletParam(context);
		const display = ctx.url.searchParams.get("display") ?? overview.available.currency;
		ctx.state.title = "Wallet · Projective";
		return page({ overview, switcher, methods, wallet, display });
	},
});

export default define.page<typeof handler>(function WalletPage({ data }) {
	return (
		<WalletOverviewScreen
			initial={data.overview}
			switcher={data.switcher}
			methods={data.methods}
			wallet={data.wallet}
			display={data.display}
		/>
	);
});
