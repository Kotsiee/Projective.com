import { type Signal, signal } from "@preact/signals";
import type { AccessStanding, ItemAccess } from "@projective/types/files";
import { FilesService } from "@features/files/core/FilesService.ts";
import { liveReach } from "./access-live.ts";
import {
	type AccessDraft,
	draftOf,
	isDirty,
	rebaseDraft,
	rowErrors as rowErrorsOf,
	toSetItemAccess,
} from "./access-draft.ts";

/**
 * access-store — one file's Access tab state as page-level signals (Decision #402). It outlives the
 * tab, so switching to Details or closing the panel keeps an unsaved draft, and it is read lazily: the
 * first visit to the tab asks the server, nothing before it.
 */

// #region State
/** Where the read of the file's access is. */
export type AccessPhase = "idle" | "loading" | "ok" | "signed-out" | "unavailable" | "error";

/** What the last save did, as the footer says it. */
export interface AccessSaveStatus {
	tone: "idle" | "busy" | "saved" | "error";
	text: string;
}

/** One file's Access tab signals. */
export interface ItemAccessStore {
	readonly itemId: string;
	readonly phase: Signal<AccessPhase>;
	/** The read's failure, while `phase` is `error`. */
	readonly error: Signal<string | null>;
	/** The server's state as last read or saved. */
	readonly access: Signal<ItemAccess | null>;
	/** The saved state as a draft, the baseline the draft is compared with. */
	readonly saved: Signal<AccessDraft | null>;
	readonly draft: Signal<AccessDraft | null>;
	readonly status: Signal<AccessSaveStatus>;
	/** A refused save's messages, keyed by grantee. */
	readonly rowErrors: Signal<Record<string, string>>;
	/** A passing word about the last edit (a grantee the file has no room for). */
	readonly notice: Signal<string | null>;
}

const IDLE_STATUS: AccessSaveStatus = { tone: "idle", text: "" };
const stores = new Map<string, ItemAccessStore>();

/** The store for one file, created on first use and kept for the page's life. */
export function accessStoreFor(itemId: string): ItemAccessStore {
	const known = stores.get(itemId);
	if (known) return known;
	const store: ItemAccessStore = {
		itemId,
		phase: signal<AccessPhase>("idle"),
		error: signal<string | null>(null),
		access: signal<ItemAccess | null>(null),
		saved: signal<AccessDraft | null>(null),
		draft: signal<AccessDraft | null>(null),
		status: signal<AccessSaveStatus>(IDLE_STATUS),
		rowErrors: signal<Record<string, string>>({}),
		notice: signal<string | null>(null),
	};
	stores.set(itemId, store);
	return store;
}

/** Whether the store holds an unsaved draft. */
export function storeDirty(store: ItemAccessStore): boolean {
	const saved = store.saved.value;
	const draft = store.draft.value;
	return saved !== null && draft !== null && isDirty(saved, draft);
}
// #endregion

// #region Reads
function adopt(store: ItemAccessStore, access: ItemAccess, keepDraft: boolean): void {
	store.access.value = access;
	store.saved.value = draftOf(access);
	if (!keepDraft || store.draft.peek() === null) store.draft.value = draftOf(access);
	liveReach.value = { visibility: access.visibility, shareUrl: access.shareUrl };
}

/**
 * Read the file's access. A re-read after another surface changed the file (the share link's dialog)
 * moves the baseline to the server's state and carries a dirty draft onto it ({@link rebaseDraft});
 * a clean draft follows the server.
 */
export async function loadAccess(
	store: ItemAccessStore,
	opts: { refresh?: boolean } = {},
): Promise<void> {
	const refresh = opts.refresh === true && store.phase.peek() === "ok";
	if (!refresh) {
		store.phase.value = "loading";
		store.error.value = null;
	}
	const read = await FilesService.access(store.itemId);
	switch (read.state) {
		case "ok": {
			const previous = store.saved.peek();
			const draft = store.draft.peek();
			if (refresh && storeDirty(store) && previous && draft) {
				store.draft.value = rebaseDraft(previous, draftOf(read.access), draft);
				adopt(store, read.access, true);
			} else adopt(store, read.access, false);
			store.phase.value = "ok";
			return;
		}
		case "signed-out":
		case "unavailable":
			if (!refresh) store.phase.value = read.state;
			return;
		case "error":
			if (refresh) {
				store.status.value = { tone: "error", text: read.message };
				return;
			}
			store.error.value = read.message;
			store.phase.value = "error";
	}
}
// #endregion

// #region Writes
/** Replace the draft, clearing what the last save said about the old one. */
export function editDraft(store: ItemAccessStore, next: AccessDraft): void {
	store.draft.value = next;
	if (store.status.peek().tone !== "busy") store.status.value = IDLE_STATUS;
}

/** Throw the draft away and return to the saved state. */
export function revertDraft(store: ItemAccessStore): void {
	const saved = store.saved.peek();
	if (!saved) return;
	store.draft.value = saved;
	store.rowErrors.value = {};
	store.notice.value = null;
	store.status.value = { tone: "idle", text: "Changes reverted." };
}

/**
 * Save the draft in one write. A refusal keeps the draft as it is, puts the server's sentence in the
 * status and each grantee's own message on its row.
 */
export async function saveDraft(store: ItemAccessStore, standing: AccessStanding): Promise<void> {
	const saved = store.saved.peek();
	const draft = store.draft.peek();
	if (!saved || !draft || store.status.peek().tone === "busy") return;
	const input = toSetItemAccess(store.itemId, saved, draft, standing);
	if (!input) return;
	store.status.value = { tone: "busy", text: "Saving…" };
	store.rowErrors.value = {};
	const res = await FilesService.setAccess(input);
	if (res.ok && res.data) {
		adopt(store, res.data, false);
		store.notice.value = null;
		store.status.value = { tone: "saved", text: "Saved." };
		return;
	}
	store.rowErrors.value = rowErrorsOf(res.errors, input);
	store.status.value = {
		tone: "error",
		text: res.message ?? "Those changes couldn't be saved. Try again.",
	};
}
// #endregion
