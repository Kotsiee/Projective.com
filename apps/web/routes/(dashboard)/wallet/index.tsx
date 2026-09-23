import { page } from "fresh";
import { asAuthenticatedContext } from "@projective/types/auth";
import { define } from "@web/utils/state.ts";
import { readActor } from "@web/utils/api-session.ts";
import WalletOverviewScreen from "@features/wallet/islands/WalletOverviewScreen.island.tsx";
import WalletUnavailable from "@features/wallet/islands/WalletUnavailable.island.tsx";
import { resolveMethods, resolveWalletFrame, resolveWalletOverview } from "@features/wallet/core/wallet-ssr.ts";

/**
 * `/wallet` — the context-scoped Wallet overview hub. Thin controller: the guest bounce is the
 * `(dashboard)` middleware's job; the wallet is resolved from the active context (or the `?w=`
 * switcher override) so the correct personal/team/business face SSR-paints in the first byte.
 *
 * The overview, the switcher and the saved payment methods are resolved together because the hero
 * band needs all three in its first paint — the balance identity, the account it belongs to, and the
 * card deck beside it. Everything is read as the signed-in viewer; `finance.*` RLS is the gate.
 */
export const handler = define.handlers({
	async GET(ctx) {
		const context = asAuthenticatedContext(ctx.state.userContext);
		const actor = readActor(ctx);
		const [read, methods, frame] = await Promise.all([
			resolveWalletOverview(context, ctx.url, actor),
			resolveMethods(context, ctx.url, actor),
			resolveWalletFrame(context, ctx.url, actor),
		]);
		ctx.state.title = "Wallet · Projective";
		return page(
			{ read, methods: methods.ok ? methods.data : { methods: [] }, ...frame },
			read.ok ? undefined : { status: 503 },
		);
	},
});

export default define.page<typeof handler>(function WalletPage({ data }) {
	if (!data.read.ok) return <WalletUnavailable title="Wallet" message={data.read.message} />;
	return (
		<WalletOverviewScreen
			initial={data.read.data.overview}
			switcher={data.read.data.switcher}
			methods={data.methods}
			wallet={data.wallet}
			display={data.display}
		/>
	);
});
