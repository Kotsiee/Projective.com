import { page } from "fresh";
import { asAuthenticatedContext } from "@projective/types/auth";
import { define } from "@web/utils/state.ts";
import { readActor } from "@web/utils/api-session.ts";
import WalletMethodsScreen from "@features/wallet/islands/WalletMethodsScreen.island.tsx";
import WalletUnavailable from "@features/wallet/islands/WalletUnavailable.island.tsx";
import { resolveMethods, resolveWalletFrame } from "@features/wallet/core/wallet-ssr.ts";

/** `/wallet/methods` — cards/banks tagged spend/earn/both, with defaults. Stripe-hosted card entry. */
export const handler = define.handlers({
	async GET(ctx) {
		const context = asAuthenticatedContext(ctx.state.userContext);
		const actor = readActor(ctx);
		const [read, frame] = await Promise.all([
			resolveMethods(context, ctx.url, actor),
			resolveWalletFrame(context, ctx.url, actor),
		]);
		ctx.state.title = "Methods · Wallet";
		return page({ read, ...frame }, read.ok ? undefined : { status: 503 });
	},
});

export default define.page<typeof handler>(function MethodsPage({ data }) {
	if (!data.read.ok) return <WalletUnavailable title="Methods" message={data.read.message} />;
	return <WalletMethodsScreen initial={data.read.data} wallet={data.wallet} display={data.display} />;
});
