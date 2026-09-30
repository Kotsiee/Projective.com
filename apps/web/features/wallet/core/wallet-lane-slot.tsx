import type { ComponentChildren } from "preact";
import type { UserContext } from "@projective/types/auth";
import { toDisplayCurrency } from "@projective/types/finance";
import type { ReadActor } from "@server/services/read-actor.ts";
import { WalletBackendService } from "@server/services/finance/WalletBackendService.ts";
import WalletLane from "../islands/WalletLane.island.tsx";
import { toFlowPeriod, viewOfPath, walletParam, walletQueryFrom } from "./wallet-model.ts";

/**
 * The middle-nav lane on every `/wallet*` route: the wallet's pages, its verification gate and its
 * action grid. It reads the overview itself — the lane is a separate hydration root from the page and
 * must paint its actions in the first byte — and resolves the wallet exactly as the page does, from
 * `?w=` and the acting context, so both regions describe the same wallet.
 *
 * A failed read still renders the lane: its page links are the way around the wallet, and the page body
 * beside it already says the wallet could not be reached. Server-only; never imported by an island.
 */
export async function walletLaneFor(
	url: URL,
	context: UserContext,
	actor: ReadActor,
): Promise<ComponentChildren> {
	if (url.pathname !== "/wallet" && !url.pathname.startsWith("/wallet/")) return null;
	const view = viewOfPath(url.pathname);
	// A retired deep-page address is a redirect and never renders; no read for it.
	if (!view) return null;

	const query = walletQueryFrom(url.searchParams, context);
	const main = await WalletBackendService.overviewWithSwitcher(query, actor);
	const overview = main.ok && main.data ? main.data.overview : null;
	const active = main.ok && main.data ? main.data.switcher.active : null;
	return (
		<WalletLane
			overview={overview}
			view={view}
			wallet={active ? walletParam(active.scope, active.id) : query.wallet ?? "personal"}
			display={active?.available.currency ||
				toDisplayCurrency(query.display ?? context.displayCurrency)}
			flow={url.searchParams.has("flow") ? toFlowPeriod(url.searchParams.get("flow")) : null}
		/>
	);
}
