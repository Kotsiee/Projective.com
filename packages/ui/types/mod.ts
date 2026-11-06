import type { VNode } from "preact";

/**
 * @projective/ui shared primitive types — used across sub-packages. Component-specific prop
 * interfaces live with their component; only cross-cutting primitives belong here.
 */

// #region Spacing
/** A spacing-scale step (`--space-0`…`--space-8`) or a raw CSS length string (e.g. `"1.5rem"`). */
export type Space = 0 | 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8 | string;

export interface PaddingProps {
	/** Padding on all sides. */
	p?: Space;
	/** Horizontal (inline) padding. */
	px?: Space;
	/** Vertical (block) padding. */
	py?: Space;
	pt?: Space;
	pr?: Space;
	pb?: Space;
	pl?: Space;
}

export interface MarginProps {
	/** Margin on all sides. */
	m?: Space;
	mx?: Space;
	my?: Space;
	mt?: Space;
	mr?: Space;
	mb?: Space;
	ml?: Space;
}
// #endregion

// #region Flex
export type Align = "start" | "center" | "end" | "stretch" | "baseline";
export type Justify = "start" | "center" | "end" | "between" | "around" | "evenly";
// #endregion

// #region Overlay geometry
/**
 * Anchored-popup placement — the side (and optional alignment) a floating surface prefers relative
 * to its trigger. Consumed by `useFloating`; flips automatically when the preferred side overflows.
 */
export type Placement =
	| "top"
	| "top-start"
	| "top-end"
	| "bottom"
	| "bottom-start"
	| "bottom-end"
	| "left"
	| "left-start"
	| "left-end"
	| "right"
	| "right-start"
	| "right-end";

/** Edge a panel docks to (Drawer/Sidebar/Sheet). `full` covers the whole viewport. */
export type Edge = "left" | "right" | "top" | "bottom" | "full";

/** Nine-point positioning for a fixed overlay (Dialog/Toast). */
export type OverlayPosition =
	| "center"
	| "top"
	| "bottom"
	| "left"
	| "right"
	| "top-left"
	| "top-right"
	| "bottom-left"
	| "bottom-right";
// #endregion

// #region Collections
/** Sort direction for a column/field. `null` clears the sort. */
export type SortDir = "asc" | "desc" | null;

/** Active sort descriptor for a single-column sort. */
export interface SortState {
	field: string;
	dir: SortDir;
}

/** Filter match modes for a column filter (Table/TreeTable/DataView). */
export type FilterMatchMode =
	| "contains"
	| "notContains"
	| "startsWith"
	| "endsWith"
	| "equals"
	| "notEquals"
	| "lt"
	| "lte"
	| "gt"
	| "gte"
	| "in"
	| "between";

/** A single column filter constraint. */
export interface FilterConstraint {
	value: unknown;
	matchMode: FilterMatchMode;
}

/**
 * A hierarchical node for Tree / TreeTable / TreeSelect / OrgChart. `data` carries the row payload;
 * `children` nest sub-nodes. Selection/expansion state is tracked externally by node `key`.
 */
export interface TreeNode<T = unknown> {
	key: string;
	label?: string;
	data?: T;
	icon?: string;
	children?: TreeNode<T>[];
	/** Lazy nodes render a toggle even before children are loaded. */
	leaf?: boolean;
	selectable?: boolean;
	/** Extra class applied to this node's row. */
	class?: string;
}

/** Lazy-load request emitted by virtualized/infinite collections. */
export interface LazyLoadEvent {
	first: number;
	last: number;
	rows: number;
	sort?: SortState;
	filters?: Record<string, FilterConstraint>;
}
// #endregion

// #region Menus
/**
 * A menu command node — the lingua franca for Menu, Menubar, TieredMenu, MegaMenu, ContextMenu,
 * ActionMenu, PanelMenu, SlideMenu, Breadcrumb, TabMenu, Steps, SpeedDial. `items` makes it a
 * submenu; a bare `separator` renders a divider row. `danger`, `hint`, `disabledReason`,
 * `emptyLabel` and `image` are read by ActionMenu; other renderers ignore them. In ActionMenu a row
 * with both `items` and a `url` or `command` is a split row: pressing it runs the row, hovering or
 * ArrowRight unfolds the submenu.
 */
export interface MenuItem {
	label?: string;
	/** Icon token/name for renderers that map it (kept string to stay library-agnostic). */
	icon?: string;
	/** Navigation target — rendered as an anchor when present. */
	url?: string;
	/** Anchor target attribute (e.g. `_blank`). */
	target?: string;
	/** Command invoked on activation (mutually exclusive with `url` in practice). */
	command?: (event: MenuItemCommandEvent) => void;
	/** Child rows — a cascading submenu. An empty array opens to {@link MenuItem.emptyLabel}. */
	items?: MenuItem[];
	/**
	 * Inert but still rendered. ActionMenu keeps a disabled row in the keyboard ring so its
	 * {@link MenuItem.disabledReason} can be read.
	 */
	disabled?: boolean;
	/** Why a `disabled` row is refused — shown in a Tooltip and announced as its description. */
	disabledReason?: string;
	/** Destructive row — drawn in the danger role. */
	danger?: boolean;
	/** One line of Meta-register secondary text under the label (e.g. "Pending invite"). */
	hint?: string;
	/** Text shown inside the submenu when `items` is an empty array, so the parent is never dead. */
	emptyLabel?: string;
	visible?: boolean;
	separator?: boolean;
	/**
	 * Leading picture (an avatar, logo or cover) drawn in place of `icon`; `null` paints the label's
	 * initials. Read by ActionMenu.
	 */
	image?: string | null;
	/**
	 * How an ActionMenu submenu opens: on hover (the default), or only when the row itself is
	 * right-clicked (or ArrowRight / the ContextMenu key) — such a row draws no caret and a press or a
	 * touch tap runs it.
	 */
	submenuOn?: "hover" | "contextmenu";
	/** Trailing badge/count. */
	badge?: string | number;
	/** Keyboard shortcut hint shown right-aligned. */
	shortcut?: string;
	/** Stable key; falls back to `label`. */
	key?: string;
	/**
	 * Custom content drawn in place of the row, with `label` as its group's accessible name (a grid of
	 * swatches). It sits in the menu's keyboard ring: focus lands on its checked or first button, and a
	 * key it leaves to bubble moves the menu on. It receives a function that closes the menu. Read by
	 * ActionMenu.
	 */
	content?: (close: () => void) => VNode;
	/** Router-active state for nav menus. */
	active?: boolean;
	class?: string;
	/** Arbitrary caller payload echoed back on `command`. */
	data?: unknown;
}

export interface MenuItemCommandEvent {
	item: MenuItem;
	originalEvent: Event;
}
// #endregion
