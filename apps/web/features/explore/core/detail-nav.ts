import type { ExploreItem, SearchPayload } from "../types/explore-types.ts";

/**
 * The Search Results detail drawer's address and reading order — pure and DOM-free, so the route
 * (deep-link resolution), the island (history sync, stepping) and the tests share one definition.
 *
 * The drawer is addressed by `?item=<id>` beside the result-set params, which `explore-state.ts`
 * reserves so it is never read as a filter facet. The id is the item's discovery id — a listing,
 * product or project slug, or a profile handle — the same key `ExploreBackendService.item` resolves.
 */

// #region Address
/** The query key that names the open item. */
export const ITEM_PARAM = "item";

/** A discovery id: a slug or a handle. Anything else is not an address and is dropped. */
const ITEM_ID = /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/;

/** The item id a query string addresses, or `null` when it names none (or names nothing valid). */
export function readItemParam(search: string | URLSearchParams): string | null {
	const sp = typeof search === "string" ? new URLSearchParams(search) : search;
	const raw = sp.get(ITEM_PARAM)?.trim() ?? "";
	return ITEM_ID.test(raw) ? raw : null;
}

/** `href` (path + query + hash) with the item param set to `id`, or removed when `id` is `null`. */
export function withItemParam(href: string, id: string | null): string {
	const url = new URL(href, "http://x");
	if (id === null) url.searchParams.delete(ITEM_PARAM);
	else url.searchParams.set(ITEM_PARAM, id);
	return url.pathname + url.search + url.hash;
}

/** Whether an item opens in the drawer at all — an article is a read and always opens its page. */
export function opensInDrawer(item: ExploreItem): boolean {
	return item.type !== "articles";
}
// #endregion

// #region Reading order
/** How many cards a merged results section shows before "Show all" — the step order stops there too. */
export const RESULTS_RAIL_CAP = 12;

/**
 * The items the reader can step through, in the order the page shows them: the isolated feed as
 * loaded, or each merged section's visible cards in section order. An item surfaced by two sections
 * is visited once, where it first appears; articles are skipped because they never open here.
 */
export function resultOrder(
	payload: Pick<SearchPayload, "isolated" | "groups">,
	feed: readonly ExploreItem[],
): ExploreItem[] {
	const source = payload.isolated
		? feed
		: payload.groups.flatMap((g) => g.items.slice(0, RESULTS_RAIL_CAP));
	const seen = new Set<string>();
	const order: ExploreItem[] = [];
	for (const item of source) {
		if (!opensInDrawer(item) || seen.has(item.id)) continue;
		seen.add(item.id);
		order.push(item);
	}
	return order;
}

/** Where an item sits in the reading order, with its neighbours. */
export interface StepPosition {
	/** Zero-based index in the order. */
	index: number;
	total: number;
	prev: ExploreItem | null;
	next: ExploreItem | null;
}

/** The position of `id` in `order`, or `null` when the order does not hold it (a deep link). */
export function stepPosition(order: readonly ExploreItem[], id: string): StepPosition | null {
	const index = order.findIndex((it) => it.id === id);
	if (index === -1) return null;
	return {
		index,
		total: order.length,
		prev: order[index - 1] ?? null,
		next: order[index + 1] ?? null,
	};
}

/** The modifier state a step key is read from. */
export interface StepKeyEvent {
	key: string;
	altKey: boolean;
	ctrlKey: boolean;
	metaKey: boolean;
	shiftKey: boolean;
}

/**
 * The step a key press asks for: `-1` previous, `1` next, `null` none. Arrow keys follow the reading
 * direction, so under `rtl` the left arrow moves forward. A modified press is the browser's or the
 * assistive technology's, never ours.
 */
export function stepFromKey(e: StepKeyEvent, dir: "ltr" | "rtl" = "ltr"): -1 | 1 | null {
	if (e.altKey || e.ctrlKey || e.metaKey || e.shiftKey) return null;
	const forward = dir === "rtl" ? "ArrowLeft" : "ArrowRight";
	const back = dir === "rtl" ? "ArrowRight" : "ArrowLeft";
	if (e.key === forward) return 1;
	if (e.key === back) return -1;
	return null;
}
// #endregion
