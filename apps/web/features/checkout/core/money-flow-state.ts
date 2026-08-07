import { signal } from "@preact/signals";
import type { FlowLeg, FlowScope, FlowWallet } from "@projective/ui/overlay";
import { LocalKeys, readStored, writeStored } from "@web/utils/storage-keys.ts";

/**
 * money-flow-state — the shared store behind the DEV-ONLY Money Flow debugger window.
 *
 * The `MoneyFlowPopover` primitive is **fully controlled**: it does zero fetch and zero arithmetic, so
 * the host supplies every wallet, every balance and every trace leg, and handles every intent. This
 * module holds that state, plus the window's persisted geometry, so the debugger survives a navigation
 * the same way the chat pop-out does.
 *
 * **Dev-only by construction.** Nothing shipping imports it: the only consumers are
 * `components/MoneyFlowMount.tsx` (which returns `null` under `IS_DEV === false`, so Vite drops the
 * whole subtree) and the build-excluded Dev Context Panel. Reading it grants no access — it changes what
 * the developer's own browser draws, nothing more.
 */

// #region Window state
/** Whether the debugger window is open. */
export const moneyFlowOpen = signal<boolean>(false);
/** The window's screen position, restored across navigations. */
export const moneyFlowPosition = signal<{ x: number; y: number } | null>(null);
/** The window's size, restored across navigations. */
export const moneyFlowSize = signal<{ w: number; h: number } | null>(null);

/** The DOM event the Dev Context Panel dispatches to open the debugger without importing the host. */
export const MONEY_FLOW_OPEN_EVENT = "pj:money-flow-open";

/**
 * Ask the mounted host to open the debugger.
 *
 * An event rather than a direct signal write so the Dev Context Panel and the host stay decoupled: the
 * panel is build-excluded and the host is `IS_DEV`-gated, and coupling them through a shared module
 * would mean whichever one survived a future refactor dragged the other back into the bundle.
 */
export function openMoneyFlow(): void {
	try {
		globalThis.dispatchEvent(new CustomEvent(MONEY_FLOW_OPEN_EVENT));
	} catch {
		// SSR / no window.
	}
}

/** Close the debugger and forget that it was open. */
export function closeMoneyFlow(): void {
	moneyFlowOpen.value = false;
	writeStored("local", LocalKeys.MONEY_FLOW_WINDOW_OPEN, "0");
}

/** Restore the window's persisted open-state and geometry (client-only; call from a mount effect). */
export function hydrateMoneyFlow(): void {
	moneyFlowOpen.value = readStored("local", LocalKeys.MONEY_FLOW_WINDOW_OPEN) === "1";
	moneyFlowPosition.value = readJson<{ x: number; y: number }>(LocalKeys.MONEY_FLOW_WINDOW_POS);
	moneyFlowSize.value = readJson<{ w: number; h: number }>(LocalKeys.MONEY_FLOW_WINDOW_SIZE);
}

/** Persist the window's open state. */
export function rememberOpen(open: boolean): void {
	moneyFlowOpen.value = open;
	writeStored("local", LocalKeys.MONEY_FLOW_WINDOW_OPEN, open ? "1" : "0");
}

/** Persist the window's position. */
export function rememberPosition(position: { x: number; y: number }): void {
	moneyFlowPosition.value = position;
	writeStored("local", LocalKeys.MONEY_FLOW_WINDOW_POS, JSON.stringify(position));
}

/** Persist the window's size. */
export function rememberSize(size: { w: number; h: number }): void {
	moneyFlowSize.value = size;
	writeStored("local", LocalKeys.MONEY_FLOW_WINDOW_SIZE, JSON.stringify(size));
}

/** Read a persisted JSON blob, or `null` when absent/corrupt. */
function readJson<T>(key: typeof LocalKeys[keyof typeof LocalKeys]): T | null {
	try {
		const raw = readStored("local", key);
		return raw ? JSON.parse(raw) as T : null;
	} catch {
		return null;
	}
}
// #endregion

// #region Debugger data (supplied by the host from the real services)
/** The principal the debugger is bound to. */
export const flowScope = signal<FlowScope>({ kind: "user", id: "", label: "Personal" });
/** Every principal the developer may switch the debugger to. */
export const flowScopes = signal<readonly FlowScope[]>([]);
/** The wallets in play, with server-read balances. */
export const flowWallets = signal<readonly FlowWallet[]>([]);
/** The inspected wallet. */
export const flowSelectedWalletId = signal<string | null>(null);
/** The ordered legs the last simulation produced. Empty until a simulate endpoint exists. */
export const flowLegs = signal<readonly FlowLeg[]>([]);
/** A read is in flight. */
export const flowBusy = signal<boolean>(false);
/** A service-level failure, or the stated reason an intent could not be honoured. */
export const flowError = signal<string | null>(null);
// #endregion
