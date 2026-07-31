import type { ComponentChildren } from "preact";
import type { UserContext } from "@projective/types/auth";
import WalletHeaderBand from "../islands/WalletHeaderBand.island.tsx";
import { resolveDisplayCurrency, resolveWalletOverview } from "./wallet-ssr.ts";
import { viewOf } from "./capability.ts";
import { defaultWalletParam } from "./wallet-model.ts";
import { walletVariant } from "../types/wallet-types.ts";

/**
 * wallet-header-slot — the middle-nav HEADER band on every `/wallet*` route.
 *
 * The wallet previously had no header band at all; the identity, the reporting window and the
 * display currency lived scattered across the lane and the body. Hoisting them into the frame's
 * header band is what lets the body hold nothing but data (BUILD CONTRACT §5.2).
 *
 * It also carries the SECTION SWITCHER for viewports below the lane's breakpoint. Section navigation
 * is the lane's job and stays there wherever the lane exists — but the lane is `display: none` under
 * 768px, and it was the surface's only route between the eight sections, so Activity, Funding,
 * Methods, Invoices and Access were unreachable on every phone. A region cannot own a
 * responsibility it does not render; below that width this band is the chrome that survives, so it
 * inherits the duty, capability-filtered by the same `laneItemsFor` the lane uses.
 *
 * Composed last in `middleNavHeaderFor`, after the projects/messaging resolvers, so exactly one
 * owns the band per URL. Server-only — never imported by an island.
 */
export function walletHeaderFor(url: URL, context: UserContext): ComponentChildren {
	if (!url.pathname.startsWith("/wallet")) return null;

	const { overview, switcher } = resolveWalletOverview(context, url);
	const display = resolveDisplayCurrency(context, url);
	const wallet = url.searchParams.get("w") ?? defaultWalletParam(context);

	return (
		<WalletHeaderBand
			account={switcher.active}
			variant={walletVariant(switcher.active.scope)}
			view={viewOf(url.pathname)}
			display={display}
			scope={wallet}
			capabilities={overview.capabilities}
		/>
	);
}
