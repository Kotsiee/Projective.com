import type { EditorialArticleCard } from "@projective/types/editorial";

/**
 * article-format.ts — how the article surfaces word their facts and arrange a page of tiles (P6).
 * Pure: the server renders every string, and the tests pin them.
 */

// #region Words
/** `8 min read` (`1 min read` for the shortest). */
export function readTimeLabel(minutes: number): string {
	return `${Math.max(1, Math.round(minutes))} min read`;
}

/**
 * A tile's date: `14 Oct 2026`, formatted in UTC so a date never shifts with the reader's zone and
 * the server and any later client render agree. An unparseable value is returned as it came.
 */
export function shortArticleDate(iso: string, locale = "en-GB"): string {
	const date = new Date(iso);
	if (Number.isNaN(date.getTime())) return iso;
	return new Intl.DateTimeFormat(locale, {
		day: "numeric",
		month: "short",
		year: "numeric",
		timeZone: "UTC",
	}).format(date);
}

/** Whether an article changed on a later calendar day (UTC) than it was published. */
export function updatedAfterPublishing(
	card: Pick<EditorialArticleCard, "publishedAt" | "updatedAt">,
): boolean {
	return card.updatedAt.slice(0, 10) > card.publishedAt.slice(0, 10);
}
// #endregion

// #region Index layout
/** One index page arranged for reading: a lead story, two features, then the grid. */
export interface IndexLayout<T> {
	lead: T | null;
	features: T[];
	grid: T[];
}

/**
 * Arrange a page of the index. Page 1 opens on the newest article as the lead and the next two as
 * features; a later page is the grid alone (its articles are not the latest, so none is led with).
 */
export function arrangeIndexPage<T>(items: readonly T[], page: number): IndexLayout<T> {
	if (page > 1 || items.length === 0) return { lead: null, features: [], grid: [...items] };
	return { lead: items[0], features: items.slice(1, 3), grid: items.slice(3) };
}
// #endregion
