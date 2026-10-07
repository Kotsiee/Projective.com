import { signal } from "@preact/signals";
import type { LedgerLine, WalletAction, WalletOverview } from "../types/wallet-types.ts";
import type { FlowPeriod } from "./wallet-model.ts";

/*
 * Every wallet page is two hydration roots — the middle-nav lane (page links, the verification gate,
 * the action grid) and the page body (hero, sheet and every dialog) — and these signals are the seam
 * between them.
 *
 * Every one of them is written ONLY from client event handlers and effects, never during a render: a
 * module signal is shared by every request a server process renders, so a value written while one
 * viewer's page renders would leak into the next viewer's. Each therefore starts `null`, and a root
 * reads its own server-resolved prop until the client has said otherwise.
 */

// #region Lane ⇄ page
/**
 * The overview the page body last read, published once it has hydrated and again after every money
 * movement, so the lane's action grid and verification gate follow what the page shows rather than
 * the snapshot the lane was server-rendered with.
 */
export const walletOverviewLive = signal<WalletOverview | null>(null);

/**
 * The cash-flow window the reader picked on the pinned ruler, so the lane's page links carry it to the
 * other page that draws one; `null` until they pick.
 */
export const walletFlowLive = signal<FlowPeriod | null>(null);
// #endregion

// #region Saved cards
/**
 * The payment method a card was just saved as (`finance.payment_methods.id`), published once the
 * server has recorded it — by the Add payment method dialog, or on the return from a bank's 3-D
 * Secure page — so the methods list marks it and the Recurring deposit picker opens on it.
 */
export const walletAddedCardId = signal<string | null>(null);

/**
 * Why a card the bank sent back from a redirect (3-D Secure) was not saved: the Add payment method
 * dialog, reopened for another try, shows it once and clears it.
 */
export const walletCardReturnNotice = signal<string | null>(null);
// #endregion

/** A dialog the command centre can open. */
export type WalletDialog =
	| { kind: "action"; action: WalletAction; stageId?: string }
	| { kind: "line"; line: LedgerLine }
	| { kind: "approval"; approvalId: string };

/** An open dialog; `id` changes on every opening so its internal state starts fresh. */
export type OpenWalletDialog = WalletDialog & { id: number };

let opened = 0;

/**
 * The open dialog. Written only from client event handlers, never during render, so concurrent server
 * renders cannot share a value through it.
 */
export const walletDialog = signal<OpenWalletDialog | null>(null);

/** Opens a dialog. */
export function openWalletDialog(dialog: WalletDialog): void {
	opened += 1;
	walletDialog.value = { ...dialog, id: opened };
}

/** Closes the open dialog — only if it is still the one opened as `id`, when an id is given. */
export function closeWalletDialog(id?: number): void {
	if (id !== undefined && walletDialog.value?.id !== id) return;
	walletDialog.value = null;
}

/** A fresh idempotency key for one attempt at a money movement; a retry reuses it. */
export function newAttemptKey(): string {
	const bytes = new Uint8Array(16);
	crypto.getRandomValues(bytes);
	return `mv-${Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("")}`;
}
