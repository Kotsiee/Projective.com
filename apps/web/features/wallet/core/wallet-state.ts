import { signal } from "@preact/signals";
import type { LedgerLine, WalletAction } from "../types/wallet-types.ts";

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
