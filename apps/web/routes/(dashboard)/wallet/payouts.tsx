import { page } from "fresh";
import { asAuthenticatedContext } from "@projective/types/auth";
import { define } from "@web/utils/state.ts";
import { readActor } from "@web/utils/api-session.ts";
import WalletPayoutsScreen from "@features/wallet/islands/WalletPayoutsScreen.island.tsx";
import WalletUnavailable from "@features/wallet/islands/WalletUnavailable.island.tsx";
import { resolvePayouts, resolveWalletFrame } from "@features/wallet/core/wallet-ssr.ts";

/** `/wallet/payouts` — payout schedule, destinations, Income Smoother, instant payout, history. */
export const handler = define.handlers({
	async GET(ctx) {
		const context = asAuthenticatedContext(ctx.state.userContext);
		const actor = readActor(ctx);
		const [read, frame] = await Promise.all([
			resolvePayouts(context, ctx.url, actor),
			resolveWalletFrame(context, ctx.url, actor),
		]);
		ctx.state.title = "Payouts · Wallet";
		return page({ read, ...frame }, read.ok ? undefined : { status: 503 });
	},
});

export default define.page<typeof handler>(function PayoutsPage({ data }) {
	if (!data.read.ok) return <WalletUnavailable title="Payouts" message={data.read.message} />;
	return <WalletPayoutsScreen initial={data.read.data} wallet={data.wallet} display={data.display} />;
});
