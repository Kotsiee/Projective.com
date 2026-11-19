import { signal } from "@preact/signals";
import type { SavedCollection, SavedTab } from "@projective/types/org";

/** What `/saved` shows: one category filter and, optionally, one list. */
export interface SavedFilter {
	tab: SavedTab;
	/** A list id, `unfiled`, or none (every save). */
	collection?: string;
}

/** The filter the lane and the page share; `null` until the page has seeded it from its URL. */
export const savedFilter = signal<SavedFilter | null>(null);

/** The viewer's lists as list boards, published by the page on every read for the lane to draw. */
export const savedBoards = signal<SavedCollection[] | null>(null);

/** Which list dialog the page should open: name a new list, or rename one. */
export type ListDialog = { mode: "new" } | { mode: "rename"; list: SavedCollection } | null;
export const listDialog = signal<ListDialog>(null);

/** Apply a filter change in place; `false` before the page has mounted (let the link navigate). */
export function patchSavedFilter(patch: Partial<SavedFilter>): boolean {
	const current = savedFilter.peek();
	if (!current) return false;
	const next = { ...current, ...patch };
	if (next.tab !== current.tab || next.collection !== current.collection) savedFilter.value = next;
	return true;
}
