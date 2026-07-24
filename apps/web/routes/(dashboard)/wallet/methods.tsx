import { page } from "fresh";
import { asAuthenticatedContext } from "@projective/types/auth";
import { define } from "@web/utils/state.ts";
import WalletMethodsScreen from "@features/wallet/islands/WalletMethodsScreen.island.tsx";
import { resolveDisplayCurrency, resolveMethods } from "@features/wallet/core/wallet-ssr.ts";
import { defaultWalletParam } from "@features/wallet/core/wallet-model.ts";

/** `/wallet/methods` — cards/banks tagged spend/earn/both, with defaults. Stripe-hosted card entry. */
export const handler = define.handlers({
	GET(ctx) {
		const context = asAuthenticatedContext(ctx.state.userContext);
		const methods = resolveMethods(context, ctx.url);
		const wallet = ctx.url.searchParams.get("w") ?? defaultWalletParam(context);
		const display = resolveDisplayCurrency(context, ctx.url);
		ctx.state.title = "Methods · Wallet";
		return page({ methods, wallet, display });
	},
});

export default define.page<typeof handler>(function MethodsPage({ data }) {
	return <WalletMethodsScreen initial={data.methods} wallet={data.wallet} display={data.display} />;
});
