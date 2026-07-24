import { page } from "fresh";
import { asAuthenticatedContext } from "@projective/types/auth";
import { define } from "@web/utils/state.ts";
import WalletPayoutsScreen from "@features/wallet/islands/WalletPayoutsScreen.island.tsx";
import { resolveDisplayCurrency, resolvePayouts } from "@features/wallet/core/wallet-ssr.ts";
import { defaultWalletParam } from "@features/wallet/core/wallet-model.ts";

/** `/wallet/payouts` — payout schedule, destinations, Income Smoother, instant payout, history. */
export const handler = define.handlers({
	GET(ctx) {
		const context = asAuthenticatedContext(ctx.state.userContext);
		const payouts = resolvePayouts(context, ctx.url);
		const wallet = ctx.url.searchParams.get("w") ?? defaultWalletParam(context);
		const display = resolveDisplayCurrency(context, ctx.url);
		ctx.state.title = "Payouts · Wallet";
		return page({ payouts, wallet, display });
	},
});

export default define.page<typeof handler>(function PayoutsPage({ data }) {
	return <WalletPayoutsScreen initial={data.payouts} wallet={data.wallet} display={data.display} />;
});
