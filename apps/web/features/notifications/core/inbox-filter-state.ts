import { signal } from "@preact/signals";
import type { InboxFilter } from "./notification-model.ts";

/**
 * inbox-filter-state — the `/notifications` filter the lane, the page's phone filter bar and the page
 * body share across their hydration roots. `null` until the page mounts and seeds it from the URL it
 * was rendered for; the server never writes it, so every SSR render falls back to its own props.
 * The page owns the address: it mirrors every change into `?category=&view=&q=` in place.
 */
export const inboxFilter = signal<InboxFilter | null>(null);

/**
 * Merge a change into the shared filter. Returns `false` (and changes nothing) before the page has
 * seeded it, so a link pressed that early can still navigate instead.
 */
export function patchInboxFilter(patch: Partial<InboxFilter>): boolean {
	const current = inboxFilter.peek();
	if (!current) return false;
	const next = { ...current, ...patch };
	const same = next.tab === current.tab && next.view === current.view &&
		next.query === current.query;
	if (!same) inboxFilter.value = next;
	return true;
}
