import type { ComponentChildren } from "preact";
import type { UserContext } from "@projective/types/auth";
import WalletLane from "../islands/WalletLane.island.tsx";
import { resolveWalletOverview } from "./wallet-ssr.ts";
import { defaultWalletParam } from "./wallet-model.ts";
import { walletVariant } from "../types/wallet-types.ts";

/**
 * wallet-lane-slot — the SSR-idiomatic resolver for the middle-nav lane on any `/wallet*` route
 * (mirrors `catalogueLaneFor`). It resolves the switcher AND the acting overview, because the lane's
 * navigation is capability-gated — `Invoices` is a business instrument and `Access` is vault
 * governance, and both are decided by **absence, not disablement**, so the lane cannot be painted
 * without knowing the viewer's capabilities and verification state in the first byte.
 *
 * Server-only (reaches `@server/services`); never imported by an island.
 */
export function walletLaneFor(url: URL, context: UserContext): ComponentChildren {
	if (!url.pathname.startsWith("/wallet")) return null;

	const { overview, switcher } = resolveWalletOverview(context, url);
	const wallet = url.searchParams.get("w") ?? defaultWalletParam(context);
	const display = url.searchParams.get("display") ?? switcher.active.available.currency ?? "GBP";

	return (
		<WalletLane
			switcher={switcher}
			activeWallet={wallet}
			variant={walletVariant(switcher.active.scope)}
			capabilities={overview.capabilities}
			verification={overview.verification}
			display={display}
			path={url.pathname}
		/>
	);
}
