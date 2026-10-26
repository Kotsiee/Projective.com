import type { JSX } from "preact";
import "../styles/wallet.css";
import type { FlowPeriod } from "../core/wallet-model.ts";
import { LedgerTools } from "../components/WalletTools.tsx";

/** Props for {@link WalletFooterRig}. */
export interface WalletFooterRigProps {
	/** The window the address names, shown until the page body hydrates and publishes its own. */
	period: FlowPeriod;
}

/**
 * The middle-nav footer band on `/wallet/transactions` and `/wallet/analytics`: the ledger tools
 * (period ruler · Download) as their own hydration root, because the shell renders the band above the
 * route. They act on the page through `walletLedgerTools`.
 */
export default function WalletFooterRig({ period }: WalletFooterRigProps): JSX.Element {
	return <LedgerTools fallback={period} />;
}
