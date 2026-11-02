import { NAV_PREVIEW_LIMIT } from "@projective/types/user";

/**
 * nav-preview-rank — the one ordering rule every rail preview follows (Decision #370): what the viewer
 * pinned (saved or starred) comes first, newest pin first, whatever its recency or urgency; the rest
 * fill the remaining slots in the destination's own ranking.
 */

/** Milliseconds since the epoch for an ISO instant; `0` for none or an unparseable one. */
export function instant(iso: string | null | undefined): number {
	return iso ? Date.parse(iso) || 0 : 0;
}

/** Newest first by `at`; unknown instants last. */
export function newestFirst<T>(at: (row: T) => string | null | undefined): (a: T, b: T) => number {
	return (a, b) => instant(at(b)) - instant(at(a));
}

/**
 * The top `limit` rows: pinned rows first, ordered by when they were pinned (newest first, a pin with
 * no recorded time after those with one, then `rank`), then the unpinned in `rank` order. `pinOf`
 * answers `undefined` for an unpinned row and the pin's instant (or `null`) for a pinned one.
 */
export function pinFirst<T>(
	rows: readonly T[],
	pinOf: (row: T) => string | null | undefined,
	rank: (a: T, b: T) => number,
	limit: number = NAV_PREVIEW_LIMIT,
): T[] {
	const pinned = rows.filter((r) => pinOf(r) !== undefined);
	const rest = rows.filter((r) => pinOf(r) === undefined);
	pinned.sort((a, b) => instant(pinOf(b)) - instant(pinOf(a)) || rank(a, b));
	rest.sort(rank);
	return [...pinned, ...rest].slice(0, limit);
}
