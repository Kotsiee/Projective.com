/**
 * @projective/ui/display — collection-local types.
 *
 * Cross-cutting primitives (`TreeNode`, `SortState`, `SortDir`, `FilterMatchMode`, `FilterConstraint`,
 * `LazyLoadEvent`, `MenuItem`) live in the package-shared `../../types/mod.ts`. Only the column
 * descriptor shared by the tabular collections (`Table`, `TreeTable`) is defined here.
 */
import type { JSX, VNode } from "preact";
import type { FilterMatchMode } from "../../types/mod.ts";

// #region Column descriptor
/** Horizontal alignment of a column's header + body content. */
export type ColumnAlign = "start" | "center" | "end";

/**
 * Declarative column descriptor for {@link Table} and {@link TreeTable}. `field` is the row property
 * read for value/sort/filter; every capability (sort, filter, resize, reorder, freeze) is opt-in per
 * column so a table only pays for what it enables. `body` overrides the default text projection with
 * a custom cell renderer.
 *
 * @typeParam T The row/node payload type.
 */
export interface TableColumn<T> {
	/** Row property key read for the default cell value, sorting and filtering. */
	field: string;
	/** Visible column header text (or the default header when no `headerTemplate` is given). */
	header?: string;
	/** Custom cell renderer — receives the row and its index; overrides the default text projection. */
	body?: (row: T, rowIndex: number) => VNode | string | number | null;
	/** Enable click-to-sort on this column's header (asc → desc → none). */
	sortable?: boolean;
	/** Render a filter control for this column in the filter row. */
	filter?: boolean;
	/** Default match mode for this column's filter (defaults to `contains`). */
	filterMatchMode?: FilterMatchMode;
	/** Allow the column to be resized via its header drag handle / keyboard. */
	resizable?: boolean;
	/** Allow the column to be reordered by dragging its header. */
	reorderable?: boolean;
	/** Pin the column so it stays visible while the body scrolls horizontally. */
	frozen?: boolean;
	/** Content alignment for header + body cells. */
	align?: ColumnAlign;
	/** Initial track width (any CSS length, e.g. `"12rem"`); resizing overrides it at runtime. */
	width?: string;
	/** Custom header renderer — overrides `header` text. */
	headerTemplate?: (column: TableColumn<T>) => VNode | string;
	/** Extra class applied to every header + body cell of this column. */
	class?: string;
	/** Custom style hook merged onto each cell of this column. */
	style?: JSX.CSSProperties;
}
// #endregion
