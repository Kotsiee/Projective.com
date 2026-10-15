/**
 * Column layout for `DataTable`: the viewer's order / widths / hidden set merged over the declared
 * columns, resizing, reordering, priority hiding on a narrow table, and the grid track template.
 * Pure — the island owns persistence and measurement.
 */
import type { ColumnLayout, DataColumn, DataColumnAlign } from "../types/data-table.ts";

const DEFAULT_WIDTHS: Record<DataColumn<unknown>["type"], number> = {
	text: 200,
	number: 112,
	date: 168,
	file: 280,
	fileSize: 104,
	image: 72,
	status: 136,
	tags: 200,
	money: 128,
	person: 200,
	people: 128,
	rating: 104,
	duration: 96,
	boolean: 88,
	custom: 160,
};

const END_ALIGNED = new Set(["number", "fileSize", "money", "duration", "rating"]);

/** Narrowest a column may be dragged when it declares no `minWidth`. */
export const DEFAULT_MIN_WIDTH = 72;
/** Widest a column may be dragged when it declares no `maxWidth`. */
export const DEFAULT_MAX_WIDTH = 640;

/** The alignment a column's header and cells use. */
export function alignOf<T>(column: DataColumn<T>): DataColumnAlign {
	if (column.align) return column.align;
	if (END_ALIGNED.has(column.type)) return "end";
	if (column.type === "boolean") return "center";
	return "start";
}

/** Clamp a width to the column's bounds. */
export function clampWidth<T>(column: DataColumn<T>, width: number): number {
	const min = column.minWidth ?? DEFAULT_MIN_WIDTH;
	const max = Math.max(min, column.maxWidth ?? DEFAULT_MAX_WIDTH);
	return Math.round(Math.min(max, Math.max(min, width)));
}

/** A column's starting width. */
export function defaultWidthOf<T>(column: DataColumn<T>): number {
	return clampWidth(column, column.width ?? DEFAULT_WIDTHS[column.type]);
}

/** Whether the viewer may hide a column from the chooser. */
export function isHideable<T>(column: DataColumn<T>): boolean {
	return !column.pinned && column.hideable !== false;
}

/**
 * Merge a saved layout over the declared columns. Unknown saved ids are dropped; a column added
 * since the layout was saved takes its declared place after its declared predecessor.
 */
export function resolveLayout<T>(
	columns: readonly DataColumn<T>[],
	saved: Partial<ColumnLayout> | null,
): ColumnLayout {
	const ids = new Set(columns.map((c) => c.id));
	const order = (saved?.order ?? []).filter((id) => ids.has(id));
	const placed = new Set(order);
	columns.forEach((column, i) => {
		if (placed.has(column.id)) return;
		const before = columns.slice(0, i).reverse().find((c) => placed.has(c.id));
		const at = before ? order.indexOf(before.id) + 1 : 0;
		order.splice(at, 0, column.id);
		placed.add(column.id);
	});

	const widths: Record<string, number> = {};
	for (const column of columns) {
		const stored = saved?.widths?.[column.id];
		widths[column.id] = typeof stored === "number" && Number.isFinite(stored)
			? clampWidth(column, stored)
			: defaultWidthOf(column);
	}

	const hidden = saved?.hidden
		? saved.hidden.filter((id) => {
			const column = columns.find((c) => c.id === id);
			return column !== undefined && isHideable(column);
		})
		: columns.filter((c) => c.defaultHidden && isHideable(c)).map((c) => c.id);

	return { order, widths, hidden };
}

/** Move column `id` to position `toIndex` within `order`. */
export function moveColumn(order: readonly string[], id: string, toIndex: number): string[] {
	const from = order.indexOf(id);
	if (from < 0) return [...order];
	const next = order.filter((x) => x !== id);
	next.splice(Math.max(0, Math.min(next.length, toIndex)), 0, id);
	return next;
}

/** Set a column's width (clamped). */
export function resizeColumn<T>(
	layout: ColumnLayout,
	column: DataColumn<T>,
	width: number,
): ColumnLayout {
	return { ...layout, widths: { ...layout.widths, [column.id]: clampWidth(column, width) } };
}

/** Show or hide a column. */
export function toggleHidden(layout: ColumnLayout, id: string): ColumnLayout {
	const hidden = layout.hidden.includes(id)
		? layout.hidden.filter((x) => x !== id)
		: [...layout.hidden, id];
	return { ...layout, hidden };
}

/** The shown columns in display order; pinned columns lead, in their declared order. */
export function orderedColumns<T>(
	columns: readonly DataColumn<T>[],
	layout: ColumnLayout,
): DataColumn<T>[] {
	const byId = new Map(columns.map((c) => [c.id, c]));
	const shown = layout.order
		.map((id) => byId.get(id))
		.filter((c): c is DataColumn<T> => c !== undefined && !layout.hidden.includes(c.id));
	return [...shown.filter((c) => c.pinned), ...shown.filter((c) => !c.pinned)];
}

function needOf<T>(column: DataColumn<T>, widths: Readonly<Record<string, number>>): number {
	return column.fill ? (column.minWidth ?? DEFAULT_MIN_WIDTH) : widths[column.id];
}

/**
 * The ids to drop so the columns fit `available` px (after `reserved` px of lead/tail tracks):
 * lowest `priority` first, and never a column without one. Pass the declared widths, not the
 * viewer's: hiding answers the container's size, so widening a column scrolls the table instead of
 * hiding the column just widened. A table still too wide afterwards scrolls horizontally.
 */
export function priorityHidden<T>(
	columns: readonly DataColumn<T>[],
	widths: Readonly<Record<string, number>>,
	available: number,
	reserved = 0,
): string[] {
	if (!(available > 0)) return [];
	let need = reserved + columns.reduce((sum, c) => sum + needOf(c, widths), 0);
	const droppable = columns
		.filter((c) => c.priority !== undefined)
		.sort((a, b) => (a.priority ?? 0) - (b.priority ?? 0));
	const dropped: string[] = [];
	for (const column of droppable) {
		if (need <= available) break;
		need -= needOf(column, widths);
		dropped.push(column.id);
	}
	return dropped;
}

/** The narrowest the shown columns can be laid out, px. */
export function minContentWidth<T>(
	columns: readonly DataColumn<T>[],
	widths: Readonly<Record<string, number>>,
	reserved = 0,
): number {
	return reserved + columns.reduce((sum, c) => sum + needOf(c, widths), 0);
}

/**
 * The `grid-template-columns` shared by the header and every row. A table with no `fill` column
 * ends in an empty `1fr` track so the hairlines still run the full width.
 */
export function gridTemplate<T>(
	columns: readonly DataColumn<T>[],
	widths: Readonly<Record<string, number>>,
	tracks: { lead: boolean; tail: boolean },
): string {
	const parts: string[] = [];
	if (tracks.lead) parts.push("var(--dt-lead-w)");
	for (const column of columns) {
		parts.push(
			column.fill
				? `minmax(${column.minWidth ?? DEFAULT_MIN_WIDTH}px, 1fr)`
				: `${widths[column.id]}px`,
		);
	}
	if (!columns.some((c) => c.fill)) parts.push("minmax(0, 1fr)");
	if (tracks.tail) parts.push("var(--dt-tail-w)");
	return parts.join(" ");
}

/** The sticky inline offset of each pinned column, px (after the lead track, `--dt-lead-w`). */
export function pinnedOffsets<T>(
	columns: readonly DataColumn<T>[],
	widths: Readonly<Record<string, number>>,
): Record<string, number> {
	const offsets: Record<string, number> = {};
	let at = 0;
	for (const column of columns) {
		if (!column.pinned) break;
		offsets[column.id] = at;
		at += needOf(column, widths);
	}
	return offsets;
}
