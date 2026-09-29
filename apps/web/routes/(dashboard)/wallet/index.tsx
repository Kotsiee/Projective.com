import { page } from "fresh";
import { asAuthenticatedContext } from "@projective/types/auth";
import { define } from "@web/utils/state.ts";
import { readActor } from "@web/utils/api-session.ts";
import WalletHome from "@features/wallet/islands/WalletHome.island.tsx";
import { resolveWalletHome } from "@features/wallet/core/wallet-ssr.ts";

/**
 * `/wallet` — the wallet command centre. Resolves the scoped wallet (`?w=`), its display currency
 * (`?display=`) and cash-flow window (`?flow=`) as the signed-in viewer; a 503 when the wallet itself
 * cannot be read.
 */
export const handler = define.handlers({
	async GET(ctx) {
		const context = asAuthenticatedContext(ctx.state.userContext);
		const home = await resolveWalletHome(context, ctx.url, readActor(ctx));
		ctx.state.title = "Wallet · Projective";
		return page({ home }, home.ok ? undefined : { status: 503 });
	},
});

export default define.page<typeof handler>(function WalletPage({ data }) {
	return <WalletHome home={data.home} />;
});
