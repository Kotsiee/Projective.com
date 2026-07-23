import type { JSX } from "preact";

/**
 * tab-shared — the small building blocks reused across the profile tab partial views (root CLAUDE.md
 * Part 2): the empty-state line and the UTC date formatter for the structured lists. Kept JSX-free of
 * any tab-specific logic so each partial view stays a thin, single-purpose component.
 */

/** A calm placeholder rendered when a tab has no items yet. */
export function Empty({ note }: { note?: string }): JSX.Element {
	return <p class="pf-empty">{note ?? "Nothing here yet."}</p>;
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
