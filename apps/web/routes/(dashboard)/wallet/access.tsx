import { page } from "fresh";
import { asAuthenticatedContext } from "@projective/types/auth";
import { define } from "@web/utils/state.ts";
import { readActor } from "@web/utils/api-session.ts";
import WalletAccessScreen from "@features/wallet/islands/WalletAccessScreen.island.tsx";
import WalletUnavailable from "@features/wallet/islands/WalletUnavailable.island.tsx";
import { resolveAccess, resolveWalletFrame } from "@features/wallet/core/wallet-ssr.ts";

/** `/wallet/access` — vault permission matrix, spending caps, approvals queue, audit log (team/business). */
export const handler = define.handlers({
	async GET(ctx) {
		const context = asAuthenticatedContext(ctx.state.userContext);
		const actor = readActor(ctx);
		const [read, frame] = await Promise.all([
			resolveAccess(context, ctx.url, actor),
			resolveWalletFrame(context, ctx.url, actor),
		]);
		ctx.state.title = "Access · Wallet";
		return page({ read, ...frame }, read.ok ? undefined : { status: 503 });
	},
});

export default define.page<typeof handler>(function AccessPage({ data }) {
	if (!data.read.ok) return <WalletUnavailable title="Access" message={data.read.message} />;
	return <WalletAccessScreen initial={data.read.data} wallet={data.wallet} display={data.display} />;
});
