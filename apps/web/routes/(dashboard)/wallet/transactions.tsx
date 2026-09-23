import { page } from "fresh";
import { asAuthenticatedContext } from "@projective/types/auth";
import { define } from "@web/utils/state.ts";
import { readActor } from "@web/utils/api-session.ts";
import WalletTransactionsScreen from "@features/wallet/islands/WalletTransactionsScreen.island.tsx";
import WalletUnavailable from "@features/wallet/islands/WalletUnavailable.island.tsx";
import { resolveTransactions, resolveWalletFrame } from "@features/wallet/core/wallet-ssr.ts";

/** `/wallet/transactions` — the full filterable ledger. Thin controller; the island refines client-side. */
export const handler = define.handlers({
	async GET(ctx) {
		const context = asAuthenticatedContext(ctx.state.userContext);
		const actor = readActor(ctx);
		const [read, frame] = await Promise.all([
			resolveTransactions(context, ctx.url, actor),
			resolveWalletFrame(context, ctx.url, actor),
		]);
		ctx.state.title = "Transactions · Wallet";
		return page({ read, ...frame }, read.ok ? undefined : { status: 503 });
	},
});

export default define.page<typeof handler>(function TransactionsPage({ data }) {
	if (!data.read.ok) return <WalletUnavailable title="Transactions" message={data.read.message} />;
	return <WalletTransactionsScreen initial={data.read.data} wallet={data.wallet} display={data.display} />;
});
