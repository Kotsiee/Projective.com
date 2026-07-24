import { page } from "fresh";
import { asAuthenticatedContext } from "@projective/types/auth";
import { define } from "@web/utils/state.ts";
import WalletAccessScreen from "@features/wallet/islands/WalletAccessScreen.island.tsx";
import { resolveAccess, resolveDisplayCurrency } from "@features/wallet/core/wallet-ssr.ts";
import { defaultWalletParam } from "@features/wallet/core/wallet-model.ts";

/** `/wallet/access` — vault permission matrix, spending caps, approvals queue, audit log (team/business). */
export const handler = define.handlers({
	GET(ctx) {
		const context = asAuthenticatedContext(ctx.state.userContext);
		const access = resolveAccess(context, ctx.url);
		const wallet = ctx.url.searchParams.get("w") ?? defaultWalletParam(context);
		const display = resolveDisplayCurrency(context, ctx.url);
		ctx.state.title = "Access · Wallet";
		return page({ access, wallet, display });
	},
});

export default define.page<typeof handler>(function AccessPage({ data }) {
	return <WalletAccessScreen initial={data.access} wallet={data.wallet} display={data.display} />;
});
