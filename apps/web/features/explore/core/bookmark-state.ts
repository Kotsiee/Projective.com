import { signal } from "@preact/signals";
import { BookmarkService } from "./BookmarkService.ts";

/**
 * bookmark-state — the page-wide store behind every discovery card's Star.
 *
 * Each card mounts its own `CardActions` island, so the saved set is a module-level signal they all
 * read: one `GET /api/explore/bookmark` per page, from whichever Star mounts first, instead of one per
 * card. A toggle is optimistic and reverts when the server refuses it.
 */

// #region State
/** The discovery ids the signed-in reader has saved. */
export const savedIds = signal<ReadonlySet<string>>(new Set());

let loading: Promise<void> | null = null;

/** Toggles made on this page, replayed over the first load so a press before it lands is kept. */
const written = new Map<string, boolean>();

/** Load the reader's saved items once per page. Signed-in callers only. */
export function hydrateSaved(): Promise<void> {
	if (!loading) {
		loading = BookmarkService.list().then((res) => {
			if (!res.ok || !res.data) return;
			const next = new Set(res.data.itemIds);
			for (const [itemId, saved] of written) {
				if (saved) next.add(itemId);
				else next.delete(itemId);
			}
			savedIds.value = next;
		});
	}
	return loading;
}
// #endregion

// #region Mutations
/** The outcome of a toggle, for the card's `role="status"` line. */
export interface SaveResult {
	ok: boolean;
	saved: boolean;
	message: string;
}

function write(itemId: string, saved: boolean): void {
	written.set(itemId, saved);
	const next = new Set(savedIds.value);
	if (saved) next.add(itemId);
	else next.delete(itemId);
	savedIds.value = next;
}

/** Save or unsave an item, resolving to the state the server settled on. */
export async function setSaved(itemId: string, saved: boolean): Promise<SaveResult> {
	const before = savedIds.value.has(itemId);
	write(itemId, saved);
	const res = await BookmarkService.set(itemId, saved);
	if (!res.ok) {
		write(itemId, before);
		return {
			ok: false,
			saved: before,
			message: res.message ?? (saved ? "We couldn't save that." : "We couldn't remove that."),
		};
	}
	return { ok: true, saved, message: saved ? "Saved" : "Removed from saved" };
}
// #endregion
