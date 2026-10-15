/**
 * @projective/ui/display — the `DataTable` contract: column descriptors, typed cell values, and the
 * sort / filter / selection / column-layout state the table exchanges with its consumer.
 */
import type { VNode } from "preact";
import type { Severity } from "../../fields/types/mod.ts";

// #region Cell values
/** What is known about an image before it arrives; structurally `ProgressiveImage`'s placeholder. */
export interface CellImagePlaceholder {
	blurhash?: string | null;
	color?: string | null;
}

/** A person rendered by `person` / `people` cells. */
export interface PersonCellValue {
	name: string;
	avatar?: string | null;
}

/** An image rendered by `image` cells and as a `file` cell's thumbnail. */
export interface ImageCellValue {
	src: string;
	alt?: string;
	placeholder?: CellImagePlaceholder | null;
}

/** A file rendered by `file` cells: a kind glyph (or a thumbnail once the row is tall enough) and a name. */
export interface FileCellValue {
	name: string;
	/** The kind glyph; file-kind marks stay feature-owned, so the consumer passes the node in. */
	icon: VNode;
	/** Shown instead of `icon` when the row is at least `DataTableProps.thumbnailMinRowHeight` tall. */
	thumb?: ImageCellValue | null;
	/** Quiet trailing meta (extension, duration) on the same line. */
	meta?: string | null;
}

/** A lifecycle status rendered as one toned `Tag`. */
export interface StatusCellValue {
	label: string;
	tone: Severity;
	icon?: VNode;
}

/** A money amount in integer minor units. */
export interface MoneyCellValue {
	minor: number;
	currency: string;
}

/** `standard` is unsigned; `income` adds `+` in the credit tone; `outgoing` adds `−` in the debit tone. */
export type MoneyFlow = "standard" | "income" | "outgoing";

/** A rating average over a count of reviews. */
export interface RatingCellValue {
	average: number | null;
	count: number;
}
// #endregion

// #region Columns
/** Horizontal alignment of a column's header and cells. */
export type DataColumnAlign = "start" | "center" | "end";

/** How numbers render in a `number` column. */
export type NumberFormat = "integer" | "decimal" | "compact" | "percent";

/** How instants render in a `date` column. */
export type DateFormat = "date" | "datetime" | "time" | "relative";

/** A selectable option of a `set` filter. */
export interface FilterOption {
	value: string;
	label: string;
}

/** The filter editor a column offers. */
export type ColumnFilterSpec =
	| { kind: "text" }
	| { kind: "range" }
	| { kind: "dateRange" }
	| { kind: "set"; options?: readonly FilterOption[] };

/** Capabilities and layout shared by every column type. */
export interface DataColumnBase<T> {
	/** Stable id: the persistence, filter and DOM key. */
	id: string;
	header: string;
	/** Hide the header text visually (it still names the column for assistive tech). */
	headerHidden?: boolean;
	/**
	 * The key emitted in {@link DataSort} for this column — lets a server-sorted table speak its API's
	 * sort vocabulary (`"recent"` for an Edited column). Defaults to `id`; `null` makes it unsortable.
	 */
	sortKey?: string | null;
	/** The direction of a column's first sort click (default `asc`). */
	firstSortDir?: DataSortDir;
	/** `true` picks the type's default editor; a spec picks one explicitly. */
	filter?: boolean | ColumnFilterSpec;
	/** Starting width in px. Ignored by a `fill` column, which takes the remaining space. */
	width?: number;
	minWidth?: number;
	maxWidth?: number;
	/** Take the remaining inline space (a `minmax(minWidth, 1fr)` track). */
	fill?: boolean;
	align?: DataColumnAlign;
	/** Importance when the table is too narrow: the lowest priority hides first; unset never hides. */
	priority?: number;
	/** Stay in view while the body scrolls horizontally. */
	pinned?: boolean;
	resizable?: boolean;
	reorderable?: boolean;
	/** Offered in the column chooser (default true; a pinned column is never hideable). */
	hideable?: boolean;
	/** Starts hidden until the viewer shows it from the column chooser. */
	defaultHidden?: boolean;
	/** The text a text filter and the type-ahead search match against (defaults per type). */
	searchText?: (row: T) => string;
}

/**
 * A column descriptor. The `type` picks the formatter and the value shape, so a column's accessor is
 * checked against what its cell can render.
 */
export type DataColumn<T> =
	& DataColumnBase<T>
	& (
		| {
			type: "text";
			value: (row: T) => string | null;
			secondary?: (row: T) => string | null;
			/** An avatar or glyph before the text. */
			lead?: (row: T) => VNode | null;
		}
		| { type: "number"; value: (row: T) => number | null; format?: NumberFormat; digits?: number }
		| { type: "date"; value: (row: T) => string | number | Date | null; format?: DateFormat }
		| { type: "file"; value: (row: T) => FileCellValue }
		| { type: "fileSize"; value: (row: T) => number | null }
		| { type: "image"; value: (row: T) => ImageCellValue | null }
		| { type: "status"; value: (row: T) => StatusCellValue | null }
		| { type: "tags"; value: (row: T) => readonly string[] }
		| {
			type: "money";
			value: (row: T) => MoneyCellValue | null;
			flow?: MoneyFlow | ((row: T) => MoneyFlow);
			hideOrigin?: boolean;
		}
		| { type: "person"; value: (row: T) => PersonCellValue | null; fallback?: (row: T) => string }
		| { type: "people"; value: (row: T) => readonly PersonCellValue[]; max?: number }
		| { type: "rating"; value: (row: T) => RatingCellValue }
		| { type: "duration"; value: (row: T) => number | null }
		| { type: "boolean"; value: (row: T) => boolean }
		| { type: "custom"; render: (row: T) => VNode | string | null; sortValue?: (row: T) => unknown }
	);

/** The `type` discriminant of {@link DataColumn}. */
export type DataColumnType = DataColumn<unknown>["type"];
// #endregion

// #region State
export type DataSortDir = "asc" | "desc";

/** One active sort, in priority order within the sort list. */
export interface DataSort {
	key: string;
	dir: DataSortDir;
}

/** `asc-desc-none` lets a third click clear the sort; `asc-desc` always keeps one. */
export type SortCycle = "asc-desc-none" | "asc-desc";

export type SelectionMode = "none" | "single" | "multiple";

/** A column's active filter. Range bounds are in the column's display unit (MB, major currency, minutes). */
export type ColumnFilterValue =
	| { kind: "text"; query: string }
	| { kind: "range"; min: number | null; max: number | null }
	| { kind: "dateRange"; from: string | null; to: string | null }
	| { kind: "set"; values: readonly string[] };

/** Active filters keyed by column id. */
export type ColumnFilterState = Readonly<Record<string, ColumnFilterValue>>;

/** The viewer's column arrangement, persisted per surface. */
export interface ColumnLayout {
	order: readonly string[];
	widths: Readonly<Record<string, number>>;
	hidden: readonly string[];
}
// #endregion
