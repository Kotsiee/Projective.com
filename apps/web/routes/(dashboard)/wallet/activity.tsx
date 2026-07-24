import { page } from "fresh";
import { asAuthenticatedContext } from "@projective/types/auth";
import { define } from "@web/utils/state.ts";
import WalletActivityScreen from "@features/wallet/islands/WalletActivityScreen.island.tsx";
import { resolveActivity, resolveDisplayCurrency } from "@features/wallet/core/wallet-ssr.ts";
import { defaultWalletParam } from "@features/wallet/core/wallet-model.ts";

/** `/wallet/activity` — the cashflow / burn-down charts. Thin controller; the island refines client-side. */
export const handler = define.handlers({
	GET(ctx) {
		const context = asAuthenticatedContext(ctx.state.userContext);
		const activity = resolveActivity(context, ctx.url);
		const wallet = ctx.url.searchParams.get("w") ?? defaultWalletParam(context);
		const display = resolveDisplayCurrency(context, ctx.url);
		ctx.state.title = "Activity · Wallet";
		return page({ activity, wallet, display });
	},
});

export default define.page<typeof handler>(function ActivityPage({ data }) {
	return (
		<WalletActivityScreen initial={data.activity} wallet={data.wallet} display={data.display} />
	);
});
