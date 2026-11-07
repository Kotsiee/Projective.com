import { columnLabel } from "./csv.ts";

/**
 * sheet-window — the pure arithmetic behind the spreadsheet grid: which rows and columns are in view,
 * and how the cursor moves. A sheet can hold 200,000 rows, so the grid only ever draws this window.
 */

// #region Geometry
/** Every row's height: fixed, because a window this cheap depends on it. */
export const SHEET_ROW_PX = 30;
/** The row-number column. */
export const SHEET_GUTTER_PX = 56;

const MIN_COLUMN_PX = 64;
const MAX_COLUMN_PX = 320;
const CHAR_PX = 7.5;
const CELL_PADDING_PX = 28;
const WIDTH_SAMPLE_ROWS = 200;

/** An inclusive run of indexes; `last < first` when there is nothing to draw. */
export interface Span {
	first: number;
	last: number;
}

/** The rows to draw for a scroll position, with a margin so a fast scroll never flashes blank. */
export function rowSpan(
	scrollTop: number,
	viewport: number,
	count: number,
	rowPx: number = SHEET_ROW_PX,
	overscan = 6,
): Span {
	if (count <= 0) return { first: 0, last: -1 };
	const first = Math.max(0, Math.floor(scrollTop / rowPx) - overscan);
	const last = Math.min(count - 1, Math.ceil((scrollTop + viewport) / rowPx) + overscan);
	return { first: Math.min(first, last), last };
}

/** Each column's leading edge, then the total: `widths.length + 1` figures. */
export function columnEdges(widths: readonly number[]): number[] {
	const edges = [0];
	for (const width of widths) edges.push(edges[edges.length - 1] + width);
	return edges;
}

function edgeAt(edges: readonly number[], x: number): number {
	let low = 0;
	let high = edges.length - 1;
	while (low < high) {
		const middle = (low + high + 1) >> 1;
		if (edges[middle] <= x) low = middle;
		else high = middle - 1;
	}
	return low;
}

/** The columns to draw for a scroll position. `scrollLeft` is measured past the gutter. */
export function columnSpan(
	edges: readonly number[],
	scrollLeft: number,
	viewport: number,
	overscan = 2,
): Span {
	const count = edges.length - 1;
	if (count <= 0) return { first: 0, last: -1 };
	const first = Math.max(0, Math.min(edgeAt(edges, scrollLeft), count - 1) - overscan);
	const last = Math.min(
		count - 1,
		Math.min(edgeAt(edges, scrollLeft + viewport), count - 1) + overscan,
	);
	return { first, last };
}

/** A width for each column: what the file declared, else one fitted to the first rows' text. */
export function fitColumnWidths(
	rows: readonly (readonly string[])[],
	columns: number,
	declared: readonly (number | null)[] = [],
): number[] {
	const sample = rows.slice(0, WIDTH_SAMPLE_ROWS);
	return Array.from({ length: columns }, (_, column) => {
		const fixed = declared[column];
		if (fixed !== undefined && fixed !== null) return fixed;
		let longest = 0;
		for (const row of sample) longest = Math.max(longest, row[column]?.length ?? 0);
		const fitted = longest * CHAR_PX + CELL_PADDING_PX;
		return Math.round(Math.min(MAX_COLUMN_PX, Math.max(MIN_COLUMN_PX, fitted)));
	});
}
// #endregion

// #region Cursor
/** A cell by its position in the view: `row` indexes the filtered, sorted order. */
export interface SheetCell {
	row: number;
	column: number;
}

/** A selection: the corner it started at, and the cell the cursor is on. */
export interface SheetCursor {
	anchor: SheetCell;
	focus: SheetCell;
}

/** A selection as its two corners. */
export interface SheetBox {
	top: number;
	left: number;
	bottom: number;
	right: number;
}

/** The rectangle a selection covers. */
export function selectionBox({ anchor, focus }: SheetCursor): SheetBox {
	return {
		top: Math.min(anchor.row, focus.row),
		left: Math.min(anchor.column, focus.column),
		bottom: Math.max(anchor.row, focus.row),
		right: Math.max(anchor.column, focus.column),
	};
}

/** The bounds and page length {@link moveCursor} needs. */
export interface SheetBounds {
	rows: number;
	columns: number;
	page: number;
}

/** The key facts {@link moveCursor} reads. */
export interface SheetKey {
	key: string;
	shiftKey: boolean;
	ctrlKey: boolean;
	metaKey: boolean;
}

function step(cell: SheetCell, press: SheetKey, bounds: SheetBounds): SheetCell | null {
	const jump = press.ctrlKey || press.metaKey;
	switch (press.key) {
		case "ArrowDown":
			return { ...cell, row: jump ? bounds.rows - 1 : cell.row + 1 };
		case "ArrowUp":
			return { ...cell, row: jump ? 0 : cell.row - 1 };
		case "ArrowRight":
			return { ...cell, column: jump ? bounds.columns - 1 : cell.column + 1 };
		case "ArrowLeft":
			return { ...cell, column: jump ? 0 : cell.column - 1 };
		case "PageDown":
			return { ...cell, row: cell.row + bounds.page };
		case "PageUp":
			return { ...cell, row: cell.row - bounds.page };
		case "Home":
			return jump ? { row: 0, column: 0 } : { ...cell, column: 0 };
		case "End":
			return jump
				? { row: bounds.rows - 1, column: bounds.columns - 1 }
				: { ...cell, column: bounds.columns - 1 };
		default:
			return null;
	}
}

/** Where a key press takes the cursor, or null when it is not a navigation key. */
export function moveCursor(
	cursor: SheetCursor | null,
	press: SheetKey,
	bounds: SheetBounds,
): SheetCursor | null {
	if (bounds.rows <= 0 || bounds.columns <= 0) return null;
	const origin = cursor?.focus ?? { row: 0, column: 0 };
	const moved = step(origin, press, bounds);
	if (!moved) return null;
	const focus = {
		row: Math.max(0, Math.min(bounds.rows - 1, moved.row)),
		column: Math.max(0, Math.min(bounds.columns - 1, moved.column)),
	};
	return { anchor: press.shiftKey && cursor ? cursor.anchor : focus, focus };
}

/** An A1-style address. `row` is the 0-based row of the sheet itself. */
export function cellAddress(row: number, column: number): string {
	return `${columnLabel(column)}${row + 1}`;
}

/** The selection as tab-separated text, the way a spreadsheet puts cells on the clipboard. */
export function selectionText(
	rows: readonly (readonly string[])[],
	order: readonly number[],
	box: SheetBox,
): string {
	const lines: string[] = [];
	for (let r = box.top; r <= box.bottom; r++) {
		const row = rows[order[r]] ?? [];
		const cells: string[] = [];
		for (let c = box.left; c <= box.right; c++) cells.push(row[c] ?? "");
		lines.push(cells.join("\t"));
	}
	return lines.join("\n");
}
// #endregion
