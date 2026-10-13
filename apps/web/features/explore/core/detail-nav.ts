import { SEARCH_SCOPES } from "@features/marketing/core/landing-data.ts";
import type { ExploreCategory, ExploreItem, SearchPayload } from "../types/explore-types.ts";

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

/** The index `delta` items from `index`, clamped to the order's ends; `null` when it cannot move. */
export function stepIndex(index: number, delta: number, total: number): number | null {
	const next = Math.min(total - 1, Math.max(0, index + delta));
	return next === index ? null : next;
}
// #endregion

// #region Entity scopes
/**
 * The search scope an entity is browsed under: freelancers and teams share "Freelancers & Teams",
 * people and businesses share "People & Businesses" (the backend's `CATEGORY_TYPES`).
 */
export function scopeOf(type: ExploreCategory): ExploreCategory {
	if (type === "teams") return "freelancers";
	if (type === "businesses") return "users";
	return type;
}

/** The scopes the drawer browses, in the scope menu's order — articles never open here. */
export const DRAWER_SCOPES: readonly ExploreCategory[] = SEARCH_SCOPES
	.map((s) => s.value)
	.filter((v) => v !== "all" && v !== "articles");

/** The scope `dir` steps away from `category` in {@link DRAWER_SCOPES}, looping at either end. */
export function adjacentScope(category: ExploreCategory, dir: -1 | 1): ExploreCategory {
	const n = DRAWER_SCOPES.length;
	const at = DRAWER_SCOPES.indexOf(scopeOf(category));
	if (at === -1) return DRAWER_SCOPES[dir === 1 ? 0 : n - 1];
	return DRAWER_SCOPES[(at + dir + n) % n];
}

/**
 * The first item of the next (or previous) entity section in the reading order, looping past either
 * end — the merged results' sections, in the order the page shows them. `null` when the order holds
 * a single section, so the caller can switch the page's scope instead.
 */
export function sectionJumpTarget(
	order: readonly ExploreItem[],
	index: number,
	dir: -1 | 1,
): ExploreItem | null {
	const starts: number[] = [];
	order.forEach((it, i) => {
		if (i === 0 || scopeOf(it.type) !== scopeOf(order[i - 1].type)) starts.push(i);
	});
	if (starts.length < 2) return null;
	let current = 0;
	for (let s = 0; s < starts.length; s++) if (starts[s] <= index) current = s;
	return order[starts[(current + dir + starts.length) % starts.length]];
}
// #endregion

// #region Keyboard
/** Items `Shift` + an arrow skips. */
export const DETAIL_JUMP = 5;

/** The modifier state a drawer key is read from. */
export interface DetailKeyEvent {
	key: string;
	altKey: boolean;
	ctrlKey: boolean;
	metaKey: boolean;
	shiftKey: boolean;
}

/** What a key press inside the open drawer asks for. */
export type DetailKeyIntent =
	| { kind: "step"; delta: number }
	| { kind: "section"; dir: -1 | 1 }
	| { kind: "scroll"; dir: -1 | 1 }
	| { kind: "open" };

/**
 * The drawer action a key press asks for, or `null` when it is not the drawer's.
 *
 * `←`/`→` step one item and `Shift` skips {@link DETAIL_JUMP}; `Ctrl` or `Cmd` (exactly one) moves
 * between entity sections. Arrows follow the reading direction, so under `rtl` the left arrow moves
 * forward. `↑`/`↓` scroll and `Enter` opens the full page, both unmodified only. `Alt` is the
 * browser's and the assistive technology's, never ours.
 */
export function detailKeyIntent(
	e: DetailKeyEvent,
	dir: "ltr" | "rtl" = "ltr",
): DetailKeyIntent | null {
	if (e.altKey || (e.ctrlKey && e.metaKey)) return null;
	const command = e.ctrlKey || e.metaKey;
	const forward = dir === "rtl" ? "ArrowLeft" : "ArrowRight";
	const back = dir === "rtl" ? "ArrowRight" : "ArrowLeft";
	const sign = e.key === forward ? 1 : e.key === back ? -1 : 0;
	if (sign !== 0) {
		if (command) return e.shiftKey ? null : { kind: "section", dir: sign };
		return { kind: "step", delta: sign * (e.shiftKey ? DETAIL_JUMP : 1) };
	}
	if (command || e.shiftKey) return null;
	if (e.key === "ArrowDown") return { kind: "scroll", dir: 1 };
	if (e.key === "ArrowUp") return { kind: "scroll", dir: -1 };
	if (e.key === "Enter") return { kind: "open" };
	return null;
}
// #endregion
