import { page } from "fresh";
import { asAuthenticatedContext } from "@projective/types/auth";
import { define } from "@web/utils/state.ts";
import { readActor } from "@web/utils/api-session.ts";
import WalletInvoicesScreen from "@features/wallet/islands/WalletInvoicesScreen.island.tsx";
import WalletUnavailable from "@features/wallet/islands/WalletUnavailable.island.tsx";
import { resolveInvoices, resolveWalletFrame } from "@features/wallet/core/wallet-ssr.ts";

/** `/wallet/invoices` — consolidated monthly statements, bills, budgets/caps (business). */
export const handler = define.handlers({
	async GET(ctx) {
		const context = asAuthenticatedContext(ctx.state.userContext);
		const actor = readActor(ctx);
		const [read, frame] = await Promise.all([
			resolveInvoices(context, ctx.url, actor),
			resolveWalletFrame(context, ctx.url, actor),
		]);
		ctx.state.title = "Invoices · Wallet";
		return page({ read, ...frame }, read.ok ? undefined : { status: 503 });
	},
});

export default define.page<typeof handler>(function InvoicesPage({ data }) {
	if (!data.read.ok) return <WalletUnavailable title="Invoices" message={data.read.message} />;
	return <WalletInvoicesScreen initial={data.read.data} wallet={data.wallet} display={data.display} />;
});
