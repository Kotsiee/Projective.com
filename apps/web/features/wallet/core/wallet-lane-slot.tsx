import type { ComponentChildren } from "preact";
import type { UserContext } from "@projective/types/auth";
import type { ReadActor } from "@server/services/read-actor.ts";
import WalletLane from "../islands/WalletLane.island.tsx";
import { resolveWalletOverview } from "./wallet-ssr.ts";
import { walletParam } from "./wallet-model.ts";
import { walletVariant } from "../types/wallet-types.ts";

/**
 * wallet-lane-slot — the SSR-idiomatic resolver for the middle-nav lane on any `/wallet*` route
 * (mirrors `catalogueLaneFor`). It resolves the switcher AND the acting overview, because the lane's
 * navigation is capability-gated — `Invoices` is a business instrument and `Access` is vault
 * governance, and both are decided by **absence, not disablement**, so the lane cannot be painted
 * without knowing the viewer's capabilities and verification state in the first byte.
 *
 * The active wallet is the one the server RESOLVED, not the one the URL asked for: a `?w=` naming a
 * vault the viewer has since left falls back to their own wallet, and the lane must point at what the
 * page is actually showing. When the wallet cannot be read the lane is withheld — the page says why.
 *
 * Server-only (reaches `@server/services`); never imported by an island.
 */
export async function walletLaneFor(url: URL, context: UserContext, actor: ReadActor): Promise<ComponentChildren> {
	if (!url.pathname.startsWith("/wallet")) return null;

	const read = await resolveWalletOverview(context, url, actor);
	if (!read.ok) return null;
	const { overview, switcher } = read.data;
	const wallet = walletParam(switcher.active.scope, switcher.active.id);
	const display = switcher.active.available.currency;

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
