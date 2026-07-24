import type { ComponentChildren } from "preact";
import type { UserContext } from "@projective/types/auth";
import WalletLane from "../islands/WalletLane.island.tsx";
import { resolveWalletSwitcher } from "./wallet-ssr.ts";
import { activeViewOf, defaultWalletParam } from "./wallet-model.ts";

/**
 * wallet-lane-slot — the SSR-idiomatic resolver for the middle-nav lane on any `/wallet*` route (mirrors
 * `catalogueLaneFor`). It resolves the wallet switcher (active wallet · selectable accounts · the
 * aggregate) so the {@link WalletLane} paints its account switcher + sub-nav in the first byte; the island
 * then tracks the display currency + dev axes live. The active wallet + view are derived from the URL so
 * the correct row/link highlights. Returns `null` off `/wallet`. Server-only (reaches `@server/services`).
 */
export function walletLaneFor(url: URL, context: UserContext): ComponentChildren {
	if (!url.pathname.startsWith("/wallet")) return null;
	const switcher = resolveWalletSwitcher(context, url);
	const wallet = url.searchParams.get("w") ?? defaultWalletParam(context);
	const view = activeViewOf(url.pathname);
	const display = url.searchParams.get("display") ?? switcher.active.available.currency ?? "GBP";
	return (
		<WalletLane
			switcher={switcher}
			activeWallet={wallet}
			activeView={view}
			display={display}
			path={url.pathname}
		/>
	);
}
