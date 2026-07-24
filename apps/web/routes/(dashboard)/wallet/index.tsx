import { page } from "fresh";
import { asAuthenticatedContext } from "@projective/types/auth";
import { define } from "@web/utils/state.ts";
import WalletOverviewScreen from "@features/wallet/islands/WalletOverviewScreen.island.tsx";
import { resolveWalletOverview } from "@features/wallet/core/wallet-ssr.ts";
import { defaultWalletParam } from "@features/wallet/core/wallet-model.ts";

/**
 * `/wallet` — the context-scoped Wallet overview hub (the calm face). Thin controller: the guest bounce
 * is the `(dashboard)` middleware's job; the wallet is resolved from the active context (or the `?w=`
 * switcher override) so the correct personal/team/business face SSR-paints in the first byte. The
 * {@link WalletOverviewScreen} island then refines only when a dev axis (currency/role/KYC/fund mix)
 * changes. No hard capability guard — the wallet is chrome + deferred `finance.*` RLS (every sibling read).
 */
export const handler = define.handlers({
	GET(ctx) {
		const context = asAuthenticatedContext(ctx.state.userContext);
		const { overview } = resolveWalletOverview(context, ctx.url);
		const wallet = ctx.url.searchParams.get("w") ?? defaultWalletParam(context);
		const display = ctx.url.searchParams.get("display") ?? overview.available.currency;
		ctx.state.title = "Wallet · Projective";
		return page({ overview, wallet, display });
	},
});

export default define.page<typeof handler>(function WalletPage({ data }) {
	return (
		<WalletOverviewScreen initial={data.overview} wallet={data.wallet} display={data.display} />
	);
});
