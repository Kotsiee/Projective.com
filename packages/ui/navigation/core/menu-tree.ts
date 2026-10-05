/**
 * Cascading-menu tree logic — the framework-agnostic half of `ActionMenu`.
 *
 * A cascading menu is a stack of levels: the root list, then one flyout per open submenu. Its whole
 * open state is one {@link MenuPath} — `path[d]` is the row index at depth `d` whose submenu is open —
 * so opening at depth `d` truncates everything deeper and closing is a slice. Keyboard input resolves
 * to a {@link MenuKeyAction}, and pointer movement resolves to a {@link HoverDecision} with an aim
 * test, so a diagonal move toward an open flyout does not switch submenus on the rows it crosses.
 */
import type { MenuItem } from "../../types/mod.ts";
import { edgeFocusable, isSeparator, nextFocusable, typeaheadIndex, visibleItems } from "./menu.ts";

// #region Tree shape
/** Open-submenu path: `path[d]` is the index, within level `d`, of the row whose submenu is open. */
export type MenuPath = readonly number[];

/** Key of the synthetic row that stands in for an empty submenu's `emptyLabel`. */
export const EMPTY_ROW_KEY = "__ui-menu-empty";

/** A row the keyboard cursor may rest on — every non-separator, disabled rows included. */
export function isReadable(item: MenuItem): boolean {
	return !isSeparator(item);
}

/** True when the item opens a cascading submenu: visible children, or an `emptyLabel` for none. */
export function isSubmenu(item: MenuItem): boolean {
	if (!Array.isArray(item.items)) return false;
	return visibleItems(item.items).length > 0 || !!item.emptyLabel;
}

/** True for the synthetic `emptyLabel` row produced by {@link submenuRows}. */
export function isEmptyRow(item: MenuItem): boolean {
	return item.key === EMPTY_ROW_KEY;
}

/** A submenu's visible rows, with one disabled `emptyLabel` row standing in for an empty list. */
export function submenuRows(item: MenuItem): MenuItem[] {
	const rows = visibleItems(item.items);
	if (rows.length > 0 || !item.emptyLabel) return rows;
	return [{ key: EMPTY_ROW_KEY, label: item.emptyLabel, disabled: true }];
}

/** The rendered levels along a path, and the part of the path that still resolves. */
export interface ResolvedTree {
	/** `levels[0]` is the root list; `levels[d]` the flyout opened from `path[d - 1]`. */
	levels: MenuItem[][];
	/** `path` truncated at the first index that no longer names an enabled submenu parent. */
	path: MenuPath;
}

/**
 * Resolve the levels a path opens. A path that outlived its model (rows removed, a parent disabled)
 * is truncated rather than trusted, so a stale flyout never renders.
 */
export function resolveLevels(model: MenuItem[], path: MenuPath): ResolvedTree {
	const levels: MenuItem[][] = [visibleItems(model)];
	const valid: number[] = [];
	for (const index of path) {
		const item = levels[levels.length - 1][index];
		if (!item || item.disabled || !isSubmenu(item)) break;
		valid.push(index);
		levels.push(submenuRows(item));
	}
	return { levels, path: valid };
}

/** Open the submenu of row `index` at `depth`, closing anything open at that depth or deeper. */
export function openSubmenu(path: MenuPath, depth: number, index: number): MenuPath {
	return [...path.slice(0, depth), index];
}

/** Close every submenu opened from `depth` or deeper; levels `0..depth` stay open. */
export function closeFrom(path: MenuPath, depth: number): MenuPath {
	return path.slice(0, Math.max(0, depth));
}

/** One Escape press: close the deepest flyout and refocus its parent row, or close the menu. */
export type EscapeStep =
	| { type: "close-level"; path: MenuPath; focus: { depth: number; index: number } }
	| { type: "close-all" };

/** Resolve what a single Escape press does for the current path. */
export function escapeStep(path: MenuPath): EscapeStep {
	if (path.length === 0) return { type: "close-all" };
	const depth = path.length - 1;
	return { type: "close-level", path: path.slice(0, depth), focus: { depth, index: path[depth] } };
}
// #endregion

// #region Keyboard
/** What a keydown on a row means; the caller owns focus and DOM. */
export type MenuKeyAction =
	| { type: "focus"; index: number }
	| { type: "open"; index: number }
	| { type: "activate"; index: number }
	| { type: "close-level" }
	| { type: "close-all" }
	| { type: "tab" }
	| { type: "typeahead"; char: string }
	| { type: "none" };

/** Input to {@link resolveMenuKey}. */
export interface MenuKeyInput {
	key: string;
	/** Rows of the level holding focus. */
	items: MenuItem[];
	/** Index of the focused row within `items`. */
	index: number;
	/** Depth of that level (0 = root). */
	depth: number;
	/** Right-to-left: the submenu opens with ArrowLeft and closes with ArrowRight. */
	rtl?: boolean;
	/** A Ctrl/Meta/Alt chord is held — printable keys are not typeahead. */
	modifier?: boolean;
}

/**
 * Resolve a keydown to a menu action. Arrows/Home/End rove over readable rows (disabled included),
 * the inline-forward arrow, Enter and Space open a submenu, the inline-back arrow closes a flyout,
 * Escape closes one level (the whole menu at the root), and Tab leaves the menu.
 */
export function resolveMenuKey(input: MenuKeyInput): MenuKeyAction {
	const { key, items, index, depth, rtl = false, modifier = false } = input;
	const item = items[index];
	const opens = !!item && !item.disabled && isSubmenu(item);
	const forward = rtl ? "ArrowLeft" : "ArrowRight";
	const back = rtl ? "ArrowRight" : "ArrowLeft";
	const focus = (
		i: number,
	): MenuKeyAction => (i < 0 ? { type: "none" } : { type: "focus", index: i });

	if (key === "ArrowDown") return focus(nextFocusable(items, index, 1, isReadable));
	if (key === "ArrowUp") return focus(nextFocusable(items, index, -1, isReadable));
	if (key === "Home") return focus(edgeFocusable(items, "first", isReadable));
	if (key === "End") return focus(edgeFocusable(items, "last", isReadable));
	if (key === "Enter" || key === " ") {
		if (!item || item.disabled) return { type: "none" };
		return opens ? { type: "open", index } : { type: "activate", index };
	}
	if (key === forward) return opens ? { type: "open", index } : { type: "none" };
	if (key === back) return depth > 0 ? { type: "close-level" } : { type: "none" };
	if (key === "Escape") return depth > 0 ? { type: "close-level" } : { type: "close-all" };
	if (key === "Tab") return { type: "tab" };
	if (!modifier && key.length === 1 && key.trim() !== "") return { type: "typeahead", char: key };
	return { type: "none" };
}

/** Accumulated typeahead buffer and the time of its last keystroke. */
export interface TypeaheadState {
	buffer: string;
	at: number;
}

/** Append a keystroke to the buffer, starting afresh after `resetMs` of silence. */
export function appendTypeahead(
	state: TypeaheadState,
	char: string,
	now: number,
	resetMs = 500,
): TypeaheadState {
	const buffer = now - state.at > resetMs ? char : state.buffer + char;
	return { buffer, at: now };
}

/**
 * The row a typeahead buffer lands on. A single character advances past the current row; a longer
 * buffer may stay on it, so typing "inv" does not skip past "Invite".
 */
export function typeaheadTarget(items: MenuItem[], index: number, buffer: string): number {
	const from = buffer.length > 1 ? index - 1 : index;
	return typeaheadIndex(items, from, buffer, isReadable);
}
// #endregion

// #region Hover intent
/** A viewport point (`clientX`/`clientY`). */
export interface Point {
	x: number;
	y: number;
}

/** A viewport box (`getBoundingClientRect` shape). */
export interface Box {
	top: number;
	right: number;
	bottom: number;
	left: number;
}

function cross(o: Point, a: Point, b: Point): number {
	return (a.x - o.x) * (b.y - o.y) - (a.y - o.y) * (b.x - o.x);
}

/** Whether `p` lies inside (or on an edge of) triangle `abc`. */
export function pointInTriangle(p: Point, a: Point, b: Point, c: Point): boolean {
	const d1 = cross(a, b, p);
	const d2 = cross(b, c, p);
	const d3 = cross(c, a, p);
	const hasNeg = d1 < 0 || d2 < 0 || d3 < 0;
	const hasPos = d1 > 0 || d2 > 0 || d3 > 0;
	return !(hasNeg && hasPos);
}

/**
 * The aim test: is the pointer, moving `from` → `to`, heading for `target`? True when `to` lies in
 * the triangle spanned by `from` and the target's near vertical edge (padded by `tolerance`), or is
 * already inside the target. A stationary pointer is not aiming.
 */
export function isAimingAt(from: Point, to: Point, target: Box, tolerance = 8): boolean {
	if (from.x === to.x && from.y === to.y) return false;
	if (to.x >= target.left && to.x <= target.right && to.y >= target.top && to.y <= target.bottom) {
		return true;
	}
	const edgeX = from.x <= target.left ? target.left : from.x >= target.right ? target.right : null;
	if (edgeX === null) return false;
	return pointInTriangle(
		to,
		from,
		{ x: edgeX, y: target.top - tolerance },
		{ x: edgeX, y: target.bottom + tolerance },
	);
}

/** What hovering a row should do to the submenu open at its depth. */
export type HoverDecision =
	| { type: "idle" }
	| { type: "open"; index: number; delay: number }
	| { type: "close"; delay: number }
	| { type: "defer"; delay: number };

/** Input to {@link resolveHover}. */
export interface HoverInput {
	/** The hovered row's index and item. */
	index: number;
	item: MenuItem;
	/** The row whose submenu is open at this depth, or -1. */
	openIndex: number;
	/** The open submenu's box, when one is open. */
	submenu: Box | null;
	/** Recent pointer positions, oldest first. */
	trail: readonly Point[];
	/** Delay before a hovered parent opens, ms. */
	openDelay?: number;
	/** Delay before a sibling closes the open submenu, ms. */
	closeDelay?: number;
	/** How long an aimed move holds the open submenu before re-deciding, ms. */
	aimDelay?: number;
}

/**
 * Hover intent for one level. Hovering the open parent keeps it; a pointer travelling toward the
 * open flyout defers any switch (re-decide after `aimDelay` with the pointer at rest); otherwise a
 * parent opens and anything else closes the open flyout, each after a short delay.
 */
export function resolveHover(input: HoverInput): HoverDecision {
	const { index, item, openIndex, submenu, trail, openDelay = 100, closeDelay = 100 } = input;
	const aimDelay = input.aimDelay ?? 250;
	if (index === openIndex) return { type: "idle" };
	const from = trail[0];
	const to = trail[trail.length - 1];
	if (openIndex >= 0 && submenu && from && to && isAimingAt(from, to, submenu)) {
		return { type: "defer", delay: aimDelay };
	}
	if (!item.disabled && isSubmenu(item)) return { type: "open", index, delay: openDelay };
	if (openIndex >= 0) return { type: "close", delay: closeDelay };
	return { type: "idle" };
}
// #endregion
