import type { HelpCentreSearchResult } from "@projective/types/editorial";

/**
 * omnibar-model.ts — the help overlay's pure rules (P2): how results group, how the arrow keys move
 * the active option, and how the overlay's query is written into the address bar so it can be shared
 * (`?q=`) and closed by removing it.
 */

// #region Grouping
/** One category's hits, each with its position in the flat option order. */
export interface ResultGroup {
	category: string;
	title: string;
	items: Array<{ result: HelpCentreSearchResult; index: number }>;
}

/**
 * Group ranked hits by category. Groups appear in the order their best hit ranked, and the flat
 * `index` runs through the groups in display order — the order the arrow keys walk.
 */
export function groupResults(results: readonly HelpCentreSearchResult[]): ResultGroup[] {
	const groups: ResultGroup[] = [];
	const byCategory = new Map<string, ResultGroup>();
	for (const result of results) {
		let group = byCategory.get(result.category);
		if (!group) {
			group = { category: result.category, title: result.categoryTitle, items: [] };
			byCategory.set(result.category, group);
			groups.push(group);
		}
		group.items.push({ result, index: -1 });
	}
	let index = 0;
	for (const group of groups) for (const item of group.items) item.index = index++;
	return groups;
}
// #endregion

// #region Keyboard
/** The keys that move the active option. */
export type NavigationKey = "ArrowDown" | "ArrowUp" | "Home" | "End";

/** Whether a key moves the active option. */
export function isNavigationKey(key: string): key is NavigationKey {
	return key === "ArrowDown" || key === "ArrowUp" || key === "Home" || key === "End";
}

/**
 * The next active option. `-1` is "none" (the field itself). Down from none is the first option and
 * Up from none the last; both wrap at the ends. With no options there is never an active one.
 */
export function nextActive(current: number, count: number, key: NavigationKey): number {
	if (count <= 0) return -1;
	switch (key) {
		case "Home":
			return 0;
		case "End":
			return count - 1;
		case "ArrowDown":
			return current < 0 || current >= count - 1 ? 0 : current + 1;
		case "ArrowUp":
			return current <= 0 ? count - 1 : current - 1;
	}
}
// #endregion

// #region Address
/** The URL with `?q=` set to `query` (the overlay is open), every other parameter and the hash kept. */
export function withQuery(href: string, query: string): string {
	const url = new URL(href);
	url.searchParams.set("q", query);
	return `${url.pathname}${url.search}${url.hash}`;
}

/** The URL with `?q=` removed (the overlay closed), every other parameter and the hash kept. */
export function withoutQuery(href: string): string {
	const url = new URL(href);
	url.searchParams.delete("q");
	return `${url.pathname}${url.search}${url.hash}`;
}
// #endregion
