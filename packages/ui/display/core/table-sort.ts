/**
 * Sorting for `DataTable`: the header click cycle, each column type's comparable value, and a stable
 * multi-key client sort. Pure.
 */
import type { DataColumn, DataSort, DataSortDir, SortCycle } from "../types/data-table.ts";
import { compareValues } from "./collection.ts";
import { toEpoch } from "./table-format.ts";

const UNSORTABLE_TYPES = new Set(["image", "tags", "people"]);

/** The key a column sorts under, or `null` when it cannot be sorted. */
export function sortKeyOf<T>(column: DataColumn<T>): string | null {
	if (column.sortKey === null) return null;
	if (column.sortKey !== undefined) return column.sortKey;
	if (UNSORTABLE_TYPES.has(column.type)) return null;
	if (column.type === "custom" && !column.sortValue) return null;
	return column.id;
}

/** Options for {@link nextSorts}. */
export interface NextSortOptions {
	/** Add to (or step within) the existing sorts instead of replacing them — Shift+click. */
	append: boolean;
	cycle: SortCycle;
	firstDir?: DataSortDir;
}

function opposite(dir: DataSortDir): DataSortDir {
	return dir === "asc" ? "desc" : "asc";
}

/**
 * The sort list after a header click on `key`.
 *
 * A plain click makes the column the only sort: a new column starts at `firstDir`, an active one
 * steps to the opposite direction and then, under `asc-desc-none`, clears. Shift+click steps the
 * column within the list without disturbing the others, appending it when absent.
 */
export function nextSorts(
	sorts: readonly DataSort[],
	key: string,
	options: NextSortOptions,
): DataSort[] {
	const first = options.firstDir ?? "asc";
	const current = sorts.find((s) => s.key === key);
	const step = (dir: DataSortDir): DataSortDir | null =>
		dir === first ? opposite(first) : options.cycle === "asc-desc-none" ? null : first;

	if (!options.append) {
		if (!current) return [{ key, dir: first }];
		if (sorts.length > 1) return [{ key, dir: current.dir }];
		const dir = step(current.dir);
		return dir ? [{ key, dir }] : [];
	}

	if (!current) return [...sorts, { key, dir: first }];
	const dir = step(current.dir);
	return dir
		? sorts.map((s) => (s.key === key ? { key, dir } : s))
		: sorts.filter((s) => s.key !== key);
}

/** The comparable value of a row under a column (numbers, epoch ms, or text). */
export function sortValueOf<T>(column: DataColumn<T>, row: T): unknown {
	switch (column.type) {
		case "text":
		case "number":
		case "fileSize":
		case "duration":
		case "boolean":
			return column.value(row);
		case "date":
			return toEpoch(column.value(row));
		case "file":
			return column.value(row).name;
		case "status":
			return column.value(row)?.label ?? null;
		case "money":
			return column.value(row)?.minor ?? null;
		case "person":
			return column.value(row)?.name ?? column.fallback?.(row) ?? null;
		case "people":
			return column.value(row).length;
		case "rating":
			return column.value(row).average;
		case "custom":
			return column.sortValue?.(row) ?? null;
		case "image":
		case "tags":
			return null;
	}
}

/**
 * Stable multi-key sort of `rows` by `sorts` (priority order). Empty values sort last in both
 * directions, so flipping a column never floods the top with blanks. Returns a new array.
 */
export function sortRowsBy<T>(
	rows: readonly T[],
	sorts: readonly DataSort[],
	columns: readonly DataColumn<T>[],
): T[] {
	const keyed = sorts
		.map((s) => ({ s, column: columns.find((c) => sortKeyOf(c) === s.key) }))
		.filter((k): k is { s: DataSort; column: DataColumn<T> } => k.column !== undefined);
	if (keyed.length === 0) return [...rows];

	const decorated = rows.map((row, index) => ({
		row,
		index,
		values: keyed.map((k) => sortValueOf(k.column, row)),
	}));
	decorated.sort((a, b) => {
		for (let i = 0; i < keyed.length; i++) {
			const x = a.values[i];
			const y = b.values[i];
			const xEmpty = x == null || x === "";
			const yEmpty = y == null || y === "";
			if (xEmpty || yEmpty) {
				if (xEmpty && yEmpty) continue;
				return xEmpty ? 1 : -1;
			}
			const cmp = compareValues(x, y);
			if (cmp !== 0) return keyed[i].s.dir === "asc" ? cmp : -cmp;
		}
		return a.index - b.index;
	});
	return decorated.map((d) => d.row);
}
