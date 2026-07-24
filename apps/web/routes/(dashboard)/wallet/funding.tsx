import { page } from "fresh";
import { asAuthenticatedContext } from "@projective/types/auth";
import { define } from "@web/utils/state.ts";
import WalletFundingScreen from "@features/wallet/islands/WalletFundingScreen.island.tsx";
import { resolveDisplayCurrency, resolveFunding } from "@features/wallet/core/wallet-ssr.ts";
import { defaultWalletParam } from "@features/wallet/core/wallet-model.ts";

/** `/wallet/funding` — funding sources + recurring auto-deposit rules + top-up. */
export const handler = define.handlers({
	GET(ctx) {
		const context = asAuthenticatedContext(ctx.state.userContext);
		const funding = resolveFunding(context, ctx.url);
		const wallet = ctx.url.searchParams.get("w") ?? defaultWalletParam(context);
		const display = resolveDisplayCurrency(context, ctx.url);
		ctx.state.title = "Funding · Wallet";
		return page({ funding, wallet, display });
	},
});

export default define.page<typeof handler>(function FundingPage({ data }) {
	return <WalletFundingScreen initial={data.funding} wallet={data.wallet} display={data.display} />;
});
