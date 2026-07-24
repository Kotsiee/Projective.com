import { computed, signal } from "@preact/signals";
import type { WalletAction, WalletSim } from "../types/wallet-types.ts";
import type { WalletContext } from "./WalletService.ts";

/**
 * wallet-state — the cross-island signals that coordinate the Wallet surface's separate hydration roots:
 * the lane (account switcher + sub-nav + period), the footer rig (transactions zoom), the page bodies,
 * and the action modals (mounted once, opened from the lane / overview / deep pages). The documented
 * module-level-signal coordination pattern (mirrors `catalogue-state` / the projects footer↔body bridge).
 *
 * The active wallet param + display currency + dev-simulation knobs are the shared read context every
 * service call threads ({@link currentWalletContext}); they are seeded from SSR and then tracked live
 * (the display currency + sim change with the Dev Context Switcher, driving a refetch).
 */

// #region Shared read context (wallet · display currency · dev simulation)
/** The active wallet param (`personal` · `team:northwind` · `aggregate`). */
export const activeWallet = signal<string>("personal");
/** The viewer's display currency (base default; the dev currency axis or a future pref override it). */
export const displayCurrency = signal<string>("GBP");
/** The live dev-simulation knobs (read from the seam by the lane island; `undefined` when inert). */
export const devSim = signal<WalletSim | undefined>(undefined);

/** Build the {@link WalletContext} every `WalletService` call threads from the current signals. */
export function currentWalletContext(): WalletContext {
	return { wallet: activeWallet.value, display: displayCurrency.value, sim: devSim.value };
}

/** Seed the shared context from SSR props (called once on the lane's mount). */
export function seedWalletContext(wallet: string, display: string): void {
	activeWallet.value = wallet;
	displayCurrency.value = display;
}
// #endregion

// #region Flow period (the lane footer's window selector)
/** The window the overview flow sparkline + Activity default report over. */
export type FlowPeriod = "30d" | "60d" | "90d";
export const flowPeriod = signal<FlowPeriod>("90d");
/** The number of trailing buckets a period selects from a 12-bucket 90-day series. */
export const flowBuckets = computed<number>(() =>
	flowPeriod.value === "30d" ? 4 : flowPeriod.value === "60d" ? 8 : 12
);
// #endregion

// #region Action modals (opened from the lane / overview / deep pages)
/** The wallet an action targets. */
export interface ActionTarget {
	scope: string;
	contextId: string;
}

/** The currently-open action modal (`null` = none). */
export const activeAction = signal<WalletAction | null>(null);
/** The wallet the open action targets. */
export const actionTarget = signal<ActionTarget | null>(null);

/** Open an action modal, seeding the target wallet (defaults to the active wallet). */
export function openWalletAction(action: WalletAction, target?: ActionTarget): void {
	actionTarget.value = target ?? parseActiveTarget();
	activeAction.value = action;
}

/** Close the open action modal. */
export function closeWalletAction(): void {
	activeAction.value = null;
}

/** Derive the `{ scope, contextId }` target from the active wallet param. */
export function parseActiveTarget(): ActionTarget {
	const w = activeWallet.value;
	if (w === "personal" || w === "aggregate" || !w.includes(":")) {
		return { scope: "personal", contextId: "" };
	}
	const [scope, id] = w.split(":");
	return { scope, contextId: id };
}
// #endregion

// #region Post-mutation refresh (a modal completed → the visible page re-reads)
/** Dispatched on a successful money mutation so every mounted wallet page refetches its data. */
export const WALLET_REFRESH_EVENT = "pj:wallet-refresh";

/** Announce that a mutation changed balances/ledger so pages refresh. */
export function notifyWalletChanged(): void {
	try {
		globalThis.dispatchEvent(new CustomEvent(WALLET_REFRESH_EVENT));
	} catch { /* SSR / no window */ }
}

/**
 * Fold the live dev-simulation knobs into a mutation payload so the refreshed overview the server returns
 * reflects the simulated role/KYC/fund-mix (the action route reads these from the body). A no-op in
 * production (the seam is never active), so a real payload is untouched.
 */
export function withSim<T extends Record<string, unknown>>(payload: T): T {
	const s = devSim.value;
	if (!s) return payload;
	return {
		...payload,
		...(s.vaultRole ? { vaultRole: s.vaultRole } : {}),
		...(s.kyc ? { kyc: s.kyc } : {}),
		...(s.smoother ? { smoother: s.smoother } : {}),
		...(s.fundMix ? { fundMix: s.fundMix } : {}),
	} as T;
}
// #endregion
