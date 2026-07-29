import type { ComponentChildren } from "preact";
import type { UserContext } from "@projective/types/auth";
import WalletFooterRig from "../islands/WalletFooterRig.island.tsx";
import { resolveWalletOverview } from "./wallet-ssr.ts";
import { defaultWalletParam } from "./wallet-model.ts";
import { viewOf } from "./capability.ts";
import { walletVariant } from "../types/wallet-types.ts";

/**
 * wallet-footer-slot — the middle-nav FOOTER band on EVERY `/wallet*` route.
 *
 * The region contract puts every money-moving action in the footer and nothing but data in the body,
 * so unlike its siblings this resolver is not scoped to one page: a wallet without its action bar
 * would have no way to move money at all. The rig changes CONFIGURATION per view (the Overview
 * carries the action cluster; a table page adds density + sort and collapses the cluster into a
 * menu), which is the island's job, not this resolver's.
 *
 * It resolves the overview because the cluster is capability- and verification-gated, and both of
 * those must be correct in the first byte — a footer that paints five actions and then removes three
 * on hydration is worse than one that paints two.
 *
 * Server-only. Composed last, after the projects/messaging/catalogue footer resolvers, so exactly
 * one owns the band per URL.
 */
export function walletFooterFor(url: URL, context: UserContext): ComponentChildren {
	if (!url.pathname.startsWith("/wallet")) return null;

	const { overview } = resolveWalletOverview(context, url);
	const wallet = url.searchParams.get("w") ?? defaultWalletParam(context);

	return (
		<WalletFooterRig
			view={viewOf(url.pathname)}
			variant={walletVariant(overview.ref.scope)}
			scope={wallet}
			quickActions={overview.quickActions}
			capabilities={overview.capabilities}
			verification={overview.verification}
		/>
	);
}
