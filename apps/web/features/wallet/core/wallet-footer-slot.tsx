import type { ComponentChildren } from "preact";
import WalletFooterRig from "../islands/WalletFooterRig.island.tsx";
import { defaultPeriodFor, toFlowPeriod, viewOfPath } from "./wallet-model.ts";

/**
 * The middle-nav footer band on the wallet pages read over a window and listing money — Transactions
 * and Analytics — carrying the period ruler and the CSV download (the overview keeps its ruler pinned
 * over the hero; Invoices has no window). A pure function of the URL: the window is the address's
 * `?flow=`, else that page's own default, so the band paints in the first byte and the page body takes
 * it over once it hydrates. Composed in `routes/(dashboard)/_layout.tsx`. Server-only; never imported
 * by an island.
 */
export function walletFooterFor(url: URL): ComponentChildren {
	const view = viewOfPath(url.pathname);
	if (view !== "transactions" && view !== "analytics") return null;
	return (
		<WalletFooterRig period={toFlowPeriod(url.searchParams.get("flow"), defaultPeriodFor(view))} />
	);
}
