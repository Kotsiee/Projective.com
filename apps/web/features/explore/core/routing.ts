import type { ExploreEntity, ExploreItem } from "../types/explore-types.ts";

/**
 * Explore navigation — the click matrix + middle-click-safe helpers.
 *
 * Every card is a real anchor whose `href` these builders produce, so the browser's native
 * middle-click / ⌘-click / "open in new tab" always works. State B additionally intercepts a PLAIN
 * left-click to open the in-place detail drawer; {@link isModifiedClick} is the guard that lets every
 * other click fall through to the browser untouched.
 */

// #region Context
/** Where the card is being rendered — decides the item deep-link shape (the click matrix). */
export type HrefContext =
	| { scope: "explore" }
	| { scope: "profile"; handle: string };

/** The four profile-shaped entities route to `/[handle]`, never to `/view/:id`. */
function isProfileEntity(type: ExploreEntity): boolean {
	return type === "users" || type === "freelancers" || type === "teams" ||
		type === "businesses";
}
// #endregion

// #region Href builders
/** A profile deep-link: `/@handle` (handles already carry the leading `@`). */
export function profileHref(handle: string): string {
	return `/${handle}`;
}

/**
 * The click matrix. From Explore: profiles → `/[handle]`, everything else →
 * `/view/[id]?type=[entity]`. From a profile page: items open under that handle's namespace,
 * `/[handle]/view/[id]?type=[entity]` (profiles still route to their own `/[handle]`).
 */
export function itemHref(item: ExploreItem, ctx: HrefContext = { scope: "explore" }): string {
	if (isProfileEntity(item.type)) return profileHref(item.owner.handle);
	const q = `/view/${item.id}?type=${item.type}`;
	return ctx.scope === "profile" ? `/${ctx.handle}/view/${item.id}?type=${item.type}` : q;
}

/**
 * A filter deep-link into Explore's search state. A skill pill or category chip links here, so
 * clicking it runs the corresponding search (and, from the Home layout, flips into Search Results).
 */
export function filterHref(params: { q?: string; category?: ExploreEntity | "all" }): string {
	const sp = new URLSearchParams();
	if (params.q) sp.set("q", params.q);
	if (params.category && params.category !== "all") sp.set("category", params.category);
	const qs = sp.toString();
	return qs ? `/explore?${qs}` : "/explore";
}
// #endregion

// #region Click guard
/**
 * True when the browser should handle the click itself — a non-primary button (middle-click), any
 * modifier key (⌘/ctrl → new tab, shift → new window, alt → download), or an already-prevented
 * event. State B only hijacks a click when this returns `false`, so new-tab behaviour is preserved.
 */
export function isModifiedClick(e: MouseEvent): boolean {
	return e.defaultPrevented || e.button !== 0 || e.metaKey || e.ctrlKey ||
		e.shiftKey || e.altKey;
}
// #endregion
