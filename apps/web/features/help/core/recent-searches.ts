/**
 * recent-searches.ts — the help overlay's "Recent searches" (P2): the last eight queries this
 * browser ran, newest first. A per-viewer convenience only, so it lives in `localStorage` and every
 * read and write is wrapped: storage that is missing, blocked (a private window, a preview, site data
 * cleared) or full simply means no recent searches, never an error.
 */

/** The storage key. */
export const RECENT_SEARCHES_KEY = "pj.help.recent";

/** How many queries are kept. */
export const RECENT_SEARCHES_MAX = 8;

/** The longest query worth remembering (the search's own input limit). */
const QUERY_MAX = 120;

/** The slice of `Storage` these helpers use, so a test can pass a stub. */
export type RecentStorage = Pick<Storage, "getItem" | "setItem" | "removeItem">;

/** The browser's `localStorage`, or `null` when there is none or it cannot be reached. */
export function browserStorage(): RecentStorage | null {
	try {
		return globalThis.localStorage ?? null;
	} catch {
		return null;
	}
}

/** Normalise a query for storage: trimmed, inner whitespace collapsed, cut to the input limit. */
function clean(query: string): string {
	return query.replace(/\s+/g, " ").trim().slice(0, QUERY_MAX);
}

/** The remembered queries, newest first. Anything unreadable reads as none. */
export function readRecentSearches(storage: RecentStorage | null): string[] {
	if (!storage) return [];
	try {
		const raw = storage.getItem(RECENT_SEARCHES_KEY);
		const parsed: unknown = raw ? JSON.parse(raw) : [];
		if (!Array.isArray(parsed)) return [];
		return parsed
			.filter((q): q is string => typeof q === "string")
			.map(clean)
			.filter((q) => q.length > 0)
			.slice(0, RECENT_SEARCHES_MAX);
	} catch {
		return [];
	}
}

/**
 * Remember a query: it moves to the front (a repeat is not stored twice, ignoring case), and the
 * list keeps the newest {@link RECENT_SEARCHES_MAX}. Answers the list as it now stands.
 */
export function rememberSearch(storage: RecentStorage | null, query: string): string[] {
	const q = clean(query);
	const prior = readRecentSearches(storage);
	if (q.length === 0) return prior;
	const next = [q, ...prior.filter((p) => p.toLowerCase() !== q.toLowerCase())].slice(
		0,
		RECENT_SEARCHES_MAX,
	);
	try {
		storage?.setItem(RECENT_SEARCHES_KEY, JSON.stringify(next));
	} catch {
		// A full or blocked store keeps the list in memory for this visit only.
	}
	return next;
}

/** Forget every remembered query. */
export function clearRecentSearches(storage: RecentStorage | null): void {
	try {
		storage?.removeItem(RECENT_SEARCHES_KEY);
	} catch {
		// Nothing to clear in a store that cannot be reached.
	}
}
