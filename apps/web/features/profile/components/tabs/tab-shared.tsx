import type { JSX } from "preact";

/**
 * tab-shared — the small building blocks reused across the profile section bodies: the empty-state
 * line, the UTC date formatter for the review list, and the newest-first sort the Experience lists
 * apply. Kept free of any tab-specific logic so each section stays a thin, single-purpose component.
 */

/** A calm placeholder rendered when a section has no items yet — the base `.pf-empty` vocabulary. */
export function Empty({ note }: { note?: string }): JSX.Element {
	return (
		<div class="pf-empty">
			<p class="pf-empty__note">{note ?? "Nothing here yet."}</p>
		</div>
	);
}

/** Format an ISO date as a stable UTC `D MMM YYYY` (SSR == client — no locale/timezone drift). */
export function formatDate(iso: string): string {
	try {
		return new Intl.DateTimeFormat("en-GB", {
			timeZone: "UTC",
			year: "numeric",
			month: "short",
			day: "numeric",
		}).format(new Date(iso));
	} catch {
		return iso;
	}
}

/**
 * A copy of `items` sorted newest-first by the string `key` yields (a year or an ISO date — a plain
 * string compare orders both). Stable, so entries sharing a year keep the server's order.
 */
export function newestFirst<T>(items: readonly T[], key: (item: T) => string): T[] {
	return items
		.map((item, index) => ({ item, index }))
		.sort((a, b) => key(b.item).localeCompare(key(a.item)) || a.index - b.index)
		.map(({ item }) => item);
}
