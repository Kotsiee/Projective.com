import { computed, signal } from "@preact/signals";
import type { FundState, LedgerLine, WalletAction, WalletSim } from "../types/wallet-types.ts";
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
		...(s.standing ? { standing: s.standing } : {}),
	} as T;
}
// #endregion

// #region Surface state (hero ⇄ ledger selection, deck, overlays)
/**
 * The fund state the viewer has selected in the hero's capital meter. Selecting a legend cell filters
 * the Recent band and syncs the URL; selecting the active one clears it. This is DATA SELECTION —
 * the body's stated remit — not navigation, so it is legal in the body (BUILD CONTRACT §12.2).
 */
export const fundFilter = signal<FundState | null>(null);

/**
 * The header band's ledger query. It lives here rather than inside the band because the band and the
 * table are separate hydration roots — the band previously held this in a local `useSignal` that
 * nothing read, so the field accepted typing and narrowed nothing. Writing it is paired with
 * {@link notifyWalletChanged}, which is what the table listens to.
 */
export const ledgerSearch = signal<string>("");

/**
 * The message from the most recent FAILED read, or `null`. Every screen's refetch was written
 * `if (res.ok && res.data) { … }` with no else, across ten call sites — so a failed currency switch,
 * dev-axis flip or post-mutation refresh left the previous wallet's figures on screen, silently and
 * indefinitely. On a surface whose entire job is conveying custody, stale money presented as current
 * money is the worst available outcome. {@link applyRead} writes this; `WalletErrorBand` renders it.
 */
export const walletError = signal<string | null>(null);

/** Whether the payment-method deck has expanded from its fanned rest state into the grid overlay. */
export const deckExpanded = signal<boolean>(false);
/** The method whose detail drawer is open (`null` = none). */
export const activeMethodId = signal<string | null>(null);

/**
 * Whether the hero has already run its count-up. Module-level so it survives a re-render: a refetch
 * (range change, currency flip, dev axis, account switch) must paint the new strings INSTANTLY and
 * never re-animate — money that appears to be spinning reads as money being counted, not held
 * (RULE M-2 / M-3).
 */
export const heroAnimated = signal<boolean>(false);

/** The ledger line whose detail drawer is open (`null` = none). */
export const drawerLine = signal<LedgerLine | null>(null);

/** Whether the parked mini-wallet (a `DraggablePopover`) is open. */
export const popoutOpen = signal<boolean>(false);

/** A money-movement flow in progress: which step, and the composed input awaiting confirmation. */
export interface MoveFlowState {
	kind: "transfer" | "withdraw" | "top_up" | "fund_escrow" | "distribute";
	step: "confirm" | "pending" | "done" | "error";
	/** The server-formatted amount, echoed verbatim into the confirm button (RULE O-2). */
	amountDisplay: string;
	amountMinor: number;
	currency: string;
	fromLabel: string;
	toLabel: string;
	note: string | null;
	/** Server message on success/failure — never composed client-side. */
	message: string | null;
	/** Recipient count, for the Distribute confirmation and its live-region announcement. */
	recipients: number;
}

/** The active money-movement flow (`null` = none). Drives {@link ConfirmMoveModal}. */
export const moveFlow = signal<MoveFlowState | null>(null);

/**
 * Reset the per-view selection state. Called when the viewer switches wallet or currency, so a
 * filter selected against one wallet's ledger never silently persists into another's.
 */
export function resetOnRefetch(): void {
	fundFilter.value = null;
	ledgerSearch.value = "";
	drawerLine.value = null;
	deckExpanded.value = false;
	activeMethodId.value = null;
}
// #endregion
