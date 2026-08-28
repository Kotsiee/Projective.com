import { LocalKeys } from "@web/utils/storage-keys.ts";
import type { ExploreEntity } from "../types/explore-types.ts";

/**
 * Explore — the per-DEVICE "what have I opened" store.
 *
 * ## What this is, stated plainly
 *
 * There is no server-side view history anywhere in this product. `ExploreBackendService.home()`
 * takes no viewer argument, `KnownAnalyticsEvent` has no view/impression member, there is no
 * `discovery.recent_views` table, and `/explore` is a public surface where the viewer may not be
 * signed in at all. So this module is `localStorage`, and it is honest about the three things that
 * makes true: it is per-device (a phone and a laptop disagree), it is cleared by private browsing,
 * and it cannot be read during SSR.
 *
 * That last one is a design constraint, not a footnote. A "Continue where you left off" heading
 * rendered on the server would be claiming a history the server cannot see — so every consumer here
 * renders NOTHING until it has hydrated and read a non-empty list.
 *
 * ## References, never snapshots
 *
 * An entry stores `{ id, type, at }` and nothing else. Caching the title, price and thumbnail would
 * make the rail renderable without a fetch, and would also make it render a card the corpus has
 * since changed — a stale price on a surface whose whole job is to send the reader back to buy
 * something. The consumer resolves the reference through the discovery service instead, so a
 * removed item simply drops out of the rail.
 */

// #region Types
/** One visited item, as a reference the discovery service can resolve. */
export interface ViewedRef {
	id: string;
	type: ExploreEntity;
	/** Epoch ms the item was opened, on THIS device's clock. */
	at: number;
}

/**
 * How many references are kept. Twelve is two full rail pages at the widest desktop cell, which is
 * more than a "continue" rail should ever show and still small enough that resolving the whole list
 * is one request.
 */
export const VIEW_HISTORY_CAP = 12;
// #endregion

// #region Read / write
/** True when `localStorage` is reachable — private modes and SSR both fail this. */
function store(): Storage | null {
	try {
		return globalThis.localStorage ?? null;
	} catch {
		return null;
	}
}

/**
 * Every entry a consumer should trust, most-recent-first.
 *
 * Total by construction: a malformed blob, a foreign shape, or a storage read that throws all
 * resolve to `[]`. A rail that hides itself is a correct outcome here; a rail that throws takes the
 * page down with it.
 */
export function readViewHistory(): ViewedRef[] {
	const s = store();
	if (!s) return [];
	try {
		const raw = s.getItem(LocalKeys.EXPLORE_RECENT_VIEWS);
		if (!raw) return [];
		const parsed: unknown = JSON.parse(raw);
		if (!Array.isArray(parsed)) return [];
		return parsed
			.filter((e): e is ViewedRef =>
				!!e && typeof e === "object" &&
				typeof (e as ViewedRef).id === "string" &&
				typeof (e as ViewedRef).type === "string" &&
				typeof (e as ViewedRef).at === "number"
			)
			.slice(0, VIEW_HISTORY_CAP);
	} catch {
		return [];
	}
}

/**
 * Record one opened item, moving it to the front if it was already there.
 *
 * De-duplication is by id and it MOVES rather than skips: re-opening something is the strongest
 * signal the reader has given about it, and a list that refused to reorder would show the thing they
 * are actually working on drifting steadily toward the end.
 *
 * `now` is a parameter with a default rather than a bare `Date.now()` read, so the ordering is a pure
 * function a test can pin.
 */
export function recordView(ref: Omit<ViewedRef, "at">, now: number = Date.now()): void {
	const s = store();
	if (!s || !ref.id) return;
	try {
		const next = [{ ...ref, at: now }, ...readViewHistory().filter((e) => e.id !== ref.id)]
			.slice(0, VIEW_HISTORY_CAP);
		s.setItem(LocalKeys.EXPLORE_RECENT_VIEWS, JSON.stringify(next));
	} catch {
		// A full or blocked quota is not worth failing a navigation over — the reader loses a rail
		// entry, and nothing else about the click changes.
	}
}
// #endregion
