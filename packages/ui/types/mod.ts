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
 * PanelMenu, SlideMenu, Breadcrumb, TabMenu, Steps, SpeedDial. `items` makes it a submenu; a bare
 * `separator` renders a divider row.
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
	items?: MenuItem[];
	disabled?: boolean;
	visible?: boolean;
	separator?: boolean;
	/** Trailing badge/count. */
	badge?: string | number;
	/** Keyboard shortcut hint shown right-aligned. */
	shortcut?: string;
	/** Stable key; falls back to `label`. */
	key?: string;
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
