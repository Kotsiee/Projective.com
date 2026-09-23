import { ExploreBackendService } from "@server/services/explore/ExploreBackendService.ts";
import type { EntityView } from "@projective/types/explore";

/**
 * View feature — the SSR resolver bridging the route/layout to the fat {@link ExploreBackendService}.
 * A single in-process call (no HTTP hop) so the standalone page AND its sidebar lane and header band
 * resolve the same composed {@link EntityView} on the first byte. Mirrors the other feature SSR
 * resolvers (`resolveProfile` / `resolveFilePage`).
 *
 * ## One read, three regions
 *
 * The page is resolved by the ROUTE HANDLER, asynchronously — the listing is read from Postgres. The
 * shell's lane and header-band slots are resolved by the LAYOUTS, which are synchronous by design
 * (every slot resolver on the platform is a pure function of the URL). Fresh runs a route's handler
 * before it renders the layouts around it, so the handler's resolution is recorded here and the slot
 * resolvers read it back with {@link peekViewPage} — one database read per request, and a page and a
 * lane that cannot disagree about which listing they are showing.
 *
 * The record is a small bounded memo keyed by id, not a cache the page is ever SERVED from: every
 * request resolves afresh in its handler first; the memo only carries that answer the few frames to
 * its own layout.
 */

// #region Memo

/** How many recent resolutions to keep — far more than the requests in flight at once. */
const MEMO_LIMIT = 256;
const recent = new Map<string, EntityView | null>();

function remember(id: string, view: EntityView | null): void {
	recent.delete(id);
	recent.set(id, view);
	while (recent.size > MEMO_LIMIT) {
		const oldest = recent.keys().next().value;
		if (oldest === undefined) break;
		recent.delete(oldest);
	}
}

// #endregion

/**
 * Resolve the composed view page for `id` — the route handler's call. `error` distinguishes "this
 * listing does not exist" (404, render not-found) from "the marketplace could not be read" (503,
 * render the error state), which are different pages for a reader and must not share one.
 */
export async function resolveViewPage(
	id: string,
): Promise<{ view: EntityView | undefined; status: number }> {
	const result = await ExploreBackendService.viewPage(id);
	const view = result.ok ? result.data : undefined;
	remember(id, view ?? null);
	return { view, status: result.status };
}

/**
 * The view page this request's handler already resolved, synchronously — for the layout slot
 * resolvers. `undefined` when no handler resolved `id` (a non-view route, or an id that failed).
 */
export function peekViewPage(id: string): { view: EntityView | undefined } {
	return { view: recent.get(id) ?? undefined };
}
