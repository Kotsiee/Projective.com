import { useEffect } from "preact/hooks";
import { type DevSeamState, readDevSeam, subscribeDevSeam } from "@web/utils/dev-seam.ts";
import { activeWallet, devSim, displayCurrency, WALLET_REFRESH_EVENT } from "./wallet-state.ts";
import type { WalletSim } from "../types/wallet-types.ts";

/**
 * wallet-seam — the client bridge from the Dev Context Switcher seam to the Wallet surface's shared
 * context signals. The server never sees the client dev seam, so the SSR first paint uses the real
 * defaults; each fetching island calls {@link useWalletSeam} to (a) mirror the display currency + the
 * simulation knobs into the shared signals, and (b) refetch when a dev override is active or changes —
 * exactly the SSR-baseline → island-re-derive pattern the session sidebar uses (Decision #48).
 *
 * Dev-only in effect: {@link readDevSeam} returns `null` in production (the seam is never written), so the
 * hook seeds the SSR display currency and never refetches — zero overhead for real users.
 */

/** Map the dev seam's wallet axes into a {@link WalletSim} (or `undefined` when no override is active). */
export function simFromSeam(seam: DevSeamState | null): WalletSim | undefined {
	if (!seam) return undefined;
	return {
		vaultRole: seam.walletVaultRole,
		kyc: seam.walletKyc,
		smoother: seam.walletSmoother,
		fundMix: seam.walletFundMix,
		standing: seam.walletStanding,
	};
}

/**
 * Sync the shared context signals from the dev seam and invoke `onRefetch` whenever the surface must
 * re-read (a dev override is active on mount, or any seam change afterwards). Seeds `activeWallet` +
 * `displayCurrency` from the SSR props so the first paint matches the server.
 */
export function useWalletSeam(
	opts: { display: string; wallet: string; onRefetch: () => void },
): void {
	const { display, wallet, onRefetch } = opts;
	useEffect(() => {
		let first = true;
		const apply = () => {
			const seam = readDevSeam();
			devSim.value = simFromSeam(seam);
			displayCurrency.value = seam?.displayCurrency ?? display;
			activeWallet.value = wallet;
			if (first) {
				first = false;
				if (seam) onRefetch(); // SSR didn't see the override — reconcile once.
			} else {
				onRefetch();
			}
		};
		apply();
		return subscribeDevSeam(apply);
	}, [display, wallet]);
}

/** Refetch whenever a money mutation completes (a modal fired {@link WALLET_REFRESH_EVENT}). */
export function useWalletRefresh(onRefetch: () => void): void {
	useEffect(() => {
		const handler = () => onRefetch();
		globalThis.addEventListener?.(WALLET_REFRESH_EVENT, handler);
		return () => globalThis.removeEventListener?.(WALLET_REFRESH_EVENT, handler);
	}, [onRefetch]);
}
