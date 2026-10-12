/// <reference lib="dom" />

import { signal } from "@preact/signals";
import { LocalKeys, readStored, removeStored, writeStored } from "@web/utils/storage-keys.ts";

/**
 * Explore — the per-DEVICE recent searches behind the typeahead's "Recent" section, stored under
 * {@link LocalKeys.EXPLORE_RECENT_SEARCHES} as a JSON array of terms, most-recent-first and capped.
 *
 * Terms only, never a scope: picking a recent search re-runs it in whatever scope the bar is in now.
 * `localStorage` cannot be read during SSR, so {@link recentSearches} is empty until
 * {@link loadRecentSearches} runs after hydration; one module signal keeps every bar on the page in
 * step, and the `storage` event keeps other tabs in step.
 */

// #region Pure list rules
/** How many terms are kept. */
export const RECENT_SEARCHES_MAX = 8;

/** The longest term worth remembering — the suggest route's own cap. */
const TERM_MAX = 80;

function normalise(term: string): string {
	return term.trim().replace(/\s+/g, " ").slice(0, TERM_MAX);
}

/** Parse a stored blob into a clean list; any malformed value reads as empty. */
export function parseRecent(raw: string | null): string[] {
	if (!raw) return [];
	let parsed: unknown;
	try {
		parsed = JSON.parse(raw);
	} catch {
		return [];
	}
	if (!Array.isArray(parsed)) return [];
	return parsed
		.filter((t): t is string => typeof t === "string")
		.map(normalise)
		.filter((t, i, all) =>
			t.length > 0 && all.findIndex((o) => o.toLowerCase() === t.toLowerCase()) === i
		)
		.slice(0, RECENT_SEARCHES_MAX);
}

/** `term` moved to the front, de-duplicated case-insensitively, capped at `max`. */
export function pushRecent(
	list: readonly string[],
	term: string,
	max = RECENT_SEARCHES_MAX,
): string[] {
	const t = normalise(term);
	if (!t) return [...list];
	return [t, ...list.filter((o) => o.toLowerCase() !== t.toLowerCase())].slice(0, max);
}

/** `list` without `term` (case-insensitive). */
export function dropRecent(list: readonly string[], term: string): string[] {
	const key = normalise(term).toLowerCase();
	return list.filter((o) => o.toLowerCase() !== key);
}

/** The recent terms that start with what is typed — the "Recent" rows shown while typing. */
export function matchRecent(list: readonly string[], typed: string, limit = 3): string[] {
	const q = normalise(typed).toLowerCase();
	if (!q) return list.slice(0, RECENT_SEARCHES_MAX);
	return list.filter((t) => t.toLowerCase().startsWith(q) && t.toLowerCase() !== q).slice(0, limit);
}
// #endregion

// #region Device store
/** The device's recent searches, most-recent-first. Empty until {@link loadRecentSearches}. */
export const recentSearches = signal<string[]>([]);

let loaded = false;

function persist(next: string[]): void {
	recentSearches.value = next;
	if (next.length === 0) removeStored("local", LocalKeys.EXPLORE_RECENT_SEARCHES);
	else writeStored("local", LocalKeys.EXPLORE_RECENT_SEARCHES, JSON.stringify(next));
}

/** Read the stored list once per page and follow other tabs' writes. Client-only. */
export function loadRecentSearches(): void {
	if (loaded || typeof globalThis.addEventListener !== "function") return;
	loaded = true;
	recentSearches.value = parseRecent(readStored("local", LocalKeys.EXPLORE_RECENT_SEARCHES));
	globalThis.addEventListener("storage", (e: StorageEvent) => {
		if (e.key === null || e.key === LocalKeys.EXPLORE_RECENT_SEARCHES) {
			recentSearches.value = parseRecent(e.newValue);
		}
	});
}

/** Remember a search the reader ran. */
export function recordSearch(term: string): void {
	loadRecentSearches();
	persist(pushRecent(recentSearches.peek(), term));
}

/** Forget one recent search. */
export function removeRecentSearch(term: string): void {
	loadRecentSearches();
	persist(dropRecent(recentSearches.peek(), term));
}

/** Forget every recent search on this device. */
export function clearRecentSearches(): void {
	persist([]);
}
// #endregion
