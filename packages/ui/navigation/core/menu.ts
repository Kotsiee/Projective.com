/**
 * Shared menu model helpers — the logic layer behind every `navigation/` menu component (Menu,
 * Menubar, MegaMenu, TieredMenu, PanelMenu, SlideMenu, ContextMenu). All consume the package-shared
 * {@link MenuItem} type, so command activation, visibility filtering, submenu/group detection, and
 * stable keying live here once instead of being re-derived per component. JSX row rendering stays in
 * each component so its BEM block name is correct; only framework-agnostic logic belongs here.
 */
import type { MenuItem, MenuItemCommandEvent } from "../../types/mod.ts";

export type { MenuItem, MenuItemCommandEvent };

// #region Predicates
/** Drop items explicitly hidden with `visible: false`; everything else is rendered. */
export function visibleItems(items?: MenuItem[]): MenuItem[] {
	return (items ?? []).filter((it) => it.visible !== false);
}

/** A bare divider row (`separator: true`), rendered as a non-focusable hairline. */
export function isSeparator(item: MenuItem): boolean {
	return item.separator === true;
}

/** True when the item nests children — a submenu (popup/flyout/accordion) or an inline group. */
export function hasChildren(item: MenuItem): boolean {
	return Array.isArray(item.items) && item.items.length > 0;
}

/**
 * True when the item participates in the roving keyboard model: not a separator, not disabled, and
 * (for inline group headers) not a bare label. Group headers are skipped by arrow navigation.
 */
export function isFocusable(item: MenuItem): boolean {
	return !isSeparator(item) && !item.disabled;
}

/** Stable list key: caller `key`, else `label`, else positional fallback. */
export function itemKey(item: MenuItem, index: number): string {
	return item.key ?? item.label ?? `item-${index}`;
}
// #endregion

// #region Activation
/**
 * Fire a menu item's effect. Disabled items and pure submenu parents are inert; a `command` is
 * invoked with the shared {@link MenuItemCommandEvent}; a `url` is treated as navigation by the
 * caller (rendered as an anchor). Returns whether the item resolved to a terminal action (so the
 * caller can close the surface).
 */
export function activate(item: MenuItem, originalEvent: Event): boolean {
	if (item.disabled || isSeparator(item)) return false;
	if (item.command) {
		item.command({ item, originalEvent });
		return true;
	}
	return !!item.url;
}
// #endregion

// #region Keyboard geometry
/**
 * Next focusable index in a flat item list, wrapping, skipping separators/disabled/group-headers.
 * `treatChildrenParentAsFocusable` keeps submenu parents in the ring (they open on Enter/Right).
 */
export function nextFocusable(items: MenuItem[], from: number, delta: 1 | -1): number {
	const n = items.length;
	if (n === 0) return -1;
	let i = from;
	for (let step = 0; step < n; step++) {
		i = (i + delta + n) % n;
		if (isFocusable(items[i])) return i;
	}
	return from;
}

/** First/last focusable index, or -1 when none. */
export function edgeFocusable(items: MenuItem[], edge: "first" | "last"): number {
	return edge === "first" ? nextFocusable(items, -1, 1) : nextFocusable(items, 0, -1);
}

/**
 * Typeahead — resolve the next index whose label starts with `buffer`, searching circularly from
 * `from`. Returns -1 when nothing matches. Buffer accumulation/timeout is owned by the caller.
 */
export function typeaheadIndex(items: MenuItem[], from: number, buffer: string): number {
	const q = buffer.toLowerCase();
	const n = items.length;
	for (let step = 1; step <= n; step++) {
		const i = (from + step + n) % n;
		const it = items[i];
		if (isFocusable(it) && (it.label ?? "").toLowerCase().startsWith(q)) return i;
	}
	return -1;
}
// #endregion
