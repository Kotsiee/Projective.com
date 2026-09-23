import { page } from "fresh";
import { asAuthenticatedContext } from "@projective/types/auth";
import { define } from "@web/utils/state.ts";
import { readActor } from "@web/utils/api-session.ts";
import WalletActivityScreen from "@features/wallet/islands/WalletActivityScreen.island.tsx";
import WalletUnavailable from "@features/wallet/islands/WalletUnavailable.island.tsx";
import { resolveActivity, resolveWalletFrame } from "@features/wallet/core/wallet-ssr.ts";

/** `/wallet/activity` — the cashflow / burn-down charts. Thin controller; the island refines client-side. */
export const handler = define.handlers({
	async GET(ctx) {
		const context = asAuthenticatedContext(ctx.state.userContext);
		const actor = readActor(ctx);
		const [read, frame] = await Promise.all([
			resolveActivity(context, ctx.url, actor),
			resolveWalletFrame(context, ctx.url, actor),
		]);
		ctx.state.title = "Activity · Wallet";
		return page({ read, ...frame }, read.ok ? undefined : { status: 503 });
	},
});

export default define.page<typeof handler>(function ActivityPage({ data }) {
	if (!data.read.ok) return <WalletUnavailable title="Activity" message={data.read.message} />;
	return <WalletActivityScreen initial={data.read.data} wallet={data.wallet} display={data.display} />;
});
