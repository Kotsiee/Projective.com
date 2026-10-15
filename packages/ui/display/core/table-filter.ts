/**
 * Column filtering for `DataTable`: which editor a column offers, the value each editor reads off a
 * row, and the client-side match. Range bounds are in the column's display unit (MB for sizes, major
 * units for money, minutes for durations) so what the viewer types is what they see in the cells.
 */
import type {
	ColumnFilterSpec,
	ColumnFilterState,
	ColumnFilterValue,
	DataColumn,
	FilterOption,
} from "../types/data-table.ts";
import { currencyExponent } from "./currency-store.ts";
import { toEpoch } from "./table-format.ts";

const MB = 1024 * 1024;
const MINUTE = 60_000;

/** The filter editor a column offers, or `null` when it is not filterable. */
export function filterSpecOf<T>(column: DataColumn<T>): ColumnFilterSpec | null {
	if (!column.filter) return null;
	if (column.filter !== true) return column.filter;
	switch (column.type) {
		case "number":
		case "fileSize":
		case "money":
		case "duration":
		case "rating":
			return { kind: "range" };
		case "date":
			return { kind: "dateRange" };
		case "status":
		case "tags":
		case "boolean":
			return { kind: "set" };
		case "custom":
		case "image":
			return column.searchText ? { kind: "text" } : null;
		default:
			return { kind: "text" };
	}
}

/** The unit label a range editor shows, if any. */
export function rangeUnitOf<T>(column: DataColumn<T>): string | null {
	if (column.type === "fileSize") return "MB";
	if (column.type === "duration") return "min";
	return null;
}

/** The text a text filter matches against. */
export function searchTextOf<T>(column: DataColumn<T>, row: T): string {
	if (column.searchText) return column.searchText(row);
	switch (column.type) {
		case "text":
			return [column.value(row), column.secondary?.(row)].filter(Boolean).join(" ");
		case "file":
			return column.value(row).name;
		case "person":
			return column.value(row)?.name ?? column.fallback?.(row) ?? "";
		case "people":
			return column.value(row).map((p) => p.name).join(" ");
		case "status":
			return column.value(row)?.label ?? "";
		case "tags":
			return column.value(row).join(" ");
		case "number":
		case "fileSize":
		case "duration":
			return String(column.value(row) ?? "");
		default:
			return "";
	}
}

/** The number a range filter compares, in the column's display unit. */
export function rangeValueOf<T>(column: DataColumn<T>, row: T): number | null {
	switch (column.type) {
		case "number":
			return column.value(row);
		case "fileSize": {
			const bytes = column.value(row);
			return bytes == null ? null : bytes / MB;
		}
		case "duration": {
			const ms = column.value(row);
			return ms == null ? null : ms / MINUTE;
		}
		case "money": {
			const money = column.value(row);
			return money ? money.minor / 10 ** currencyExponent(money.currency) : null;
		}
		case "rating":
			return column.value(row).average;
		default:
			return null;
	}
}

/** The values a set filter matches against (a row matches when any of them is chosen). */
export function setValuesOf<T>(column: DataColumn<T>, row: T): string[] {
	switch (column.type) {
		case "status": {
			const status = column.value(row);
			return status ? [status.label] : [];
		}
		case "tags":
			return [...column.value(row)];
		case "boolean":
			return [column.value(row) ? "Yes" : "No"];
		default:
			return [searchTextOf(column, row)].filter(Boolean);
	}
}

/** A set filter's options: the declared ones, else every distinct value among `rows`. */
export function setOptionsOf<T>(column: DataColumn<T>, rows: readonly T[]): FilterOption[] {
	const spec = filterSpecOf(column);
	if (spec?.kind === "set" && spec.options) return [...spec.options];
	const seen = new Set<string>();
	for (const row of rows) for (const value of setValuesOf(column, row)) seen.add(value);
	return [...seen]
		.sort((a, b) => a.localeCompare(b, undefined, { sensitivity: "base" }))
		.map((value) => ({ value, label: value }));
}

/** Whether a filter value narrows anything. */
export function isFilterActive(value: ColumnFilterValue | undefined): boolean {
	if (!value) return false;
	switch (value.kind) {
		case "text":
			return value.query.trim() !== "";
		case "range":
			return value.min != null || value.max != null;
		case "dateRange":
			return Boolean(value.from || value.to);
		case "set":
			return value.values.length > 0;
	}
}

/** `YYYY-MM-DD` as the epoch of that day's start (`edge: "start"`) or end, in local time. */
export function dayEdge(day: string, edge: "start" | "end"): number | null {
	const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(day);
	if (!match) return null;
	const [, y, m, d] = match;
	const start = new Date(Number(y), Number(m) - 1, Number(d)).getTime();
	return edge === "start" ? start : start + 86_400_000 - 1;
}

/** Whether one row passes one column's filter. */
export function matchesFilter<T>(column: DataColumn<T>, row: T, value: ColumnFilterValue): boolean {
	if (!isFilterActive(value)) return true;
	switch (value.kind) {
		case "text":
			return searchTextOf(column, row).toLowerCase().includes(value.query.trim().toLowerCase());
		case "range": {
			const n = rangeValueOf(column, row);
			if (n == null) return false;
			return (value.min == null || n >= value.min) && (value.max == null || n <= value.max);
		}
		case "dateRange": {
			if (column.type !== "date") return true;
			const ms = toEpoch(column.value(row));
			if (ms == null) return false;
			const from = value.from ? dayEdge(value.from, "start") : null;
			const to = value.to ? dayEdge(value.to, "end") : null;
			return (from == null || ms >= from) && (to == null || ms <= to);
		}
		case "set": {
			const chosen = new Set(value.values);
			return setValuesOf(column, row).some((v) => chosen.has(v));
		}
	}
}

/** Rows passing every active column filter (AND across columns). Returns a new array. */
export function filterRowsBy<T>(
	rows: readonly T[],
	filters: ColumnFilterState,
	columns: readonly DataColumn<T>[],
): T[] {
	const active = Object.entries(filters)
		.filter(([, value]) => isFilterActive(value))
		.map(([id, value]) => ({ column: columns.find((c) => c.id === id), value }))
		.filter((f): f is { column: DataColumn<T>; value: ColumnFilterValue } =>
			f.column !== undefined
		);
	if (active.length === 0) return [...rows];
	return rows.filter((row) => active.every((f) => matchesFilter(f.column, row, f.value)));
}

/** Split `text` around case-insensitive occurrences of `query`, for in-cell match highlighting. */
export function highlightParts(text: string, query: string): { text: string; match: boolean }[] {
	const needle = query.trim().toLowerCase();
	if (!needle || !text) return [{ text, match: false }];
	const parts: { text: string; match: boolean }[] = [];
	const hay = text.toLowerCase();
	let at = 0;
	while (at < text.length) {
		const hit = hay.indexOf(needle, at);
		if (hit < 0) break;
		if (hit > at) parts.push({ text: text.slice(at, hit), match: false });
		parts.push({ text: text.slice(hit, hit + needle.length), match: true });
		at = hit + needle.length;
	}
	if (at < text.length) parts.push({ text: text.slice(at), match: false });
	return parts;
}
