import { page } from "fresh";
import { asAuthenticatedContext } from "@projective/types/auth";
import { define } from "@web/utils/state.ts";
import WalletInvoicesScreen from "@features/wallet/islands/WalletInvoicesScreen.island.tsx";
import { resolveDisplayCurrency, resolveInvoices } from "@features/wallet/core/wallet-ssr.ts";
import { defaultWalletParam } from "@features/wallet/core/wallet-model.ts";

/** `/wallet/invoices` — consolidated monthly statements, bills, budgets/caps (business). */
export const handler = define.handlers({
	GET(ctx) {
		const context = asAuthenticatedContext(ctx.state.userContext);
		const invoices = resolveInvoices(context, ctx.url);
		const wallet = ctx.url.searchParams.get("w") ?? defaultWalletParam(context);
		const display = resolveDisplayCurrency(context, ctx.url);
		ctx.state.title = "Invoices · Wallet";
		return page({ invoices, wallet, display });
	},
});

export default define.page<typeof handler>(function InvoicesPage({ data }) {
	return (
		<WalletInvoicesScreen initial={data.invoices} wallet={data.wallet} display={data.display} />
	);
});
