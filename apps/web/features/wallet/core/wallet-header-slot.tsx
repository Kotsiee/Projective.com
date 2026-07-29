import type { ComponentChildren } from "preact";
import type { UserContext } from "@projective/types/auth";
import WalletHeaderBand from "../islands/WalletHeaderBand.island.tsx";
import { resolveDisplayCurrency, resolveWalletSwitcher } from "./wallet-ssr.ts";
import { viewOf } from "./capability.ts";
import { walletVariant } from "../types/wallet-types.ts";

/**
 * wallet-header-slot — the middle-nav HEADER band on every `/wallet*` route.
 *
 * The wallet previously had no header band at all; the identity, the reporting window and the
 * display currency lived scattered across the lane and the body. Hoisting them into the frame's
 * header band is what lets the body hold nothing but data (BUILD CONTRACT §5.2).
 *
 * Composed last in `middleNavHeaderFor`, after the projects/messaging resolvers, so exactly one
 * owns the band per URL. Server-only — never imported by an island.
 */
export function walletHeaderFor(url: URL, context: UserContext): ComponentChildren {
	if (!url.pathname.startsWith("/wallet")) return null;

	const switcher = resolveWalletSwitcher(context, url);
	const display = resolveDisplayCurrency(context, url);

	return (
		<WalletHeaderBand
			account={switcher.active}
			variant={walletVariant(switcher.active.scope)}
			view={viewOf(url.pathname)}
			display={display}
		/>
	);
}
