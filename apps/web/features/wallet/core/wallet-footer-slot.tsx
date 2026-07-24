import type { ComponentChildren } from "preact";
import type { UserContext } from "@projective/types/auth";
import WalletViewControlRig from "../islands/WalletViewControlRig.island.tsx";

/**
 * wallet-footer-slot — the SSR-idiomatic resolver for the middle-nav FOOTER band on the Wallet
 * Transactions ledger (`/wallet/transactions`). It mounts the zoom {@link WalletViewControlRig} (mirrors
 * `filesFooterFor`/`catalogueFooterFor`), a dumb island driving the shared ledger zoom signal — so it
 * stays a pure URL match. The other wallet pages carry their own controls (the overview period selector
 * lives in the lane footer), so they get no rig. Returns `null` everywhere else. Composed after the
 * projects/messaging/catalogue footer resolvers so exactly one owns the footer band per URL.
 */
export function walletFooterFor(url: URL, _context: UserContext): ComponentChildren {
	const segs = url.pathname.split("/").filter(Boolean); // ["wallet", view?]
	if (segs[0] !== "wallet" || segs[1] !== "transactions") return null;
	return <WalletViewControlRig />;
}
