import { page } from "fresh";
import { asAuthenticatedContext } from "@projective/types/auth";
import { define } from "@web/utils/state.ts";
import WalletTransactionsScreen from "@features/wallet/islands/WalletTransactionsScreen.island.tsx";
import { resolveDisplayCurrency, resolveTransactions } from "@features/wallet/core/wallet-ssr.ts";
import { defaultWalletParam } from "@features/wallet/core/wallet-model.ts";

/** `/wallet/transactions` — the full filterable ledger. Thin controller; the island refines client-side. */
export const handler = define.handlers({
	GET(ctx) {
		const context = asAuthenticatedContext(ctx.state.userContext);
		const { page: pageData } = resolveTransactions(context, ctx.url);
		const wallet = ctx.url.searchParams.get("w") ?? defaultWalletParam(context);
		const display = resolveDisplayCurrency(context, ctx.url);
		ctx.state.title = "Transactions · Wallet";
		return page({ page: pageData, wallet, display });
	},
});

export default define.page<typeof handler>(function TransactionsPage({ data }) {
	return (
		<WalletTransactionsScreen initial={data.page} wallet={data.wallet} display={data.display} />
	);
});
