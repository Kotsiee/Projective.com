import { page } from "fresh";
import { asAuthenticatedContext } from "@projective/types/auth";
import { define } from "@web/utils/state.ts";
import { readActor } from "@web/utils/api-session.ts";
import WalletFundingScreen from "@features/wallet/islands/WalletFundingScreen.island.tsx";
import WalletUnavailable from "@features/wallet/islands/WalletUnavailable.island.tsx";
import { resolveFunding, resolveWalletFrame } from "@features/wallet/core/wallet-ssr.ts";

/** `/wallet/funding` — funding sources + recurring auto-deposit rules + top-up. */
export const handler = define.handlers({
	async GET(ctx) {
		const context = asAuthenticatedContext(ctx.state.userContext);
		const actor = readActor(ctx);
		const [read, frame] = await Promise.all([
			resolveFunding(context, ctx.url, actor),
			resolveWalletFrame(context, ctx.url, actor),
		]);
		ctx.state.title = "Funding · Wallet";
		return page({ read, ...frame }, read.ok ? undefined : { status: 503 });
	},
});

export default define.page<typeof handler>(function FundingPage({ data }) {
	if (!data.read.ok) return <WalletUnavailable title="Funding" message={data.read.message} />;
	return <WalletFundingScreen initial={data.read.data} wallet={data.wallet} display={data.display} />;
});
