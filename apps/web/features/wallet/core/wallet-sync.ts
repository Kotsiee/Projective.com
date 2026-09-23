import { useEffect } from "preact/hooks";
import { activeWallet, displayCurrency, WALLET_REFRESH_EVENT, walletError } from "./wallet-state.ts";
import type { WalletResult } from "../types/results.ts";

/**
 * wallet-sync — how a fetching Wallet island joins the surface's shared read context.
 *
 * The server resolves the first paint (which wallet, which display currency) and every island mounts
 * with those facts as props. {@link useWalletSync} copies them into the shared signals the thin
 * `WalletService` threads, so an island's refetch asks for the SAME wallet in the SAME currency its
 * first byte was drawn in; {@link useWalletRefresh} re-reads when a money action or the header band's
 * currency toggle announces a change; {@link applyRead} is the one place a read is unwrapped.
 */

/** Seed the shared wallet + display currency from the server-resolved props (and on a change to them). */
export function useWalletSync(opts: { display: string; wallet: string }): void {
	const { display, wallet } = opts;
	useEffect(() => {
		displayCurrency.value = display;
		activeWallet.value = wallet;
	}, [display, wallet]);
}

/**
 * Apply a read's payload, or record why it failed. The ONE place a wallet read is unwrapped.
 *
 * Every screen previously wrote `if (res.ok && res.data) { … }` and stopped there, so a failure was
 * indistinguishable from a no-op: the previous wallet's balances stayed on screen after a currency
 * switch or an account switch that never landed. Routing every call site through here means a failed
 * read always says so, and a successful one always clears the last complaint.
 */
export function applyRead<T>(res: WalletResult<T>, apply: (data: T) => void): void {
	if (res.ok && res.data) {
		walletError.value = null;
		apply(res.data);
		return;
	}
	walletError.value = res.message ?? Object.values(res.errors ?? {})[0] ??
		"These figures could not be refreshed just now.";
}

/** Refetch whenever a money mutation completes (a modal fired {@link WALLET_REFRESH_EVENT}). */
export function useWalletRefresh(onRefetch: () => void): void {
	useEffect(() => {
		const handler = () => onRefetch();
		globalThis.addEventListener?.(WALLET_REFRESH_EVENT, handler);
		return () => globalThis.removeEventListener?.(WALLET_REFRESH_EVENT, handler);
	}, [onRefetch]);
}
