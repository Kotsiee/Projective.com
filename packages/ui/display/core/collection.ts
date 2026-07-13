/**
 * Shared value/sort/filter primitives for the tabular collections (`Table`, `TreeTable`). Kept free
 * of Preact so both islands can compose the same comparison + match-mode semantics without
 * duplicating logic. All helpers are pure.
 */
import type { FilterConstraint, SortDir, SortState } from "../../types/mod.ts";

// #region Value access
/**
 * Read a (optionally dotted) field path off a row. `"a.b.c"` walks nested objects; a bare key does a
 * single lookup. Returns `undefined` for a missing path rather than throwing.
 */
export function getFieldValue(row: unknown, field: string): unknown {
	if (row == null) return undefined;
	if (!field.includes(".")) return (row as Record<string, unknown>)[field];
	let cur: unknown = row;
	for (const part of field.split(".")) {
		if (cur == null) return undefined;
		cur = (cur as Record<string, unknown>)[part];
	}
	return cur;
}

/** Coerce any cell value to a comparable/display string (null → ""). */
export function toText(value: unknown): string {
	if (value == null) return "";
	if (value instanceof Date) return value.toISOString();
	return String(value);
}
// #endregion

// #region Sorting
/** Three-way comparison of two arbitrary cell values (numbers, dates, strings, booleans). */
export function compareValues(a: unknown, b: unknown): number {
	if (a == null && b == null) return 0;
	if (a == null) return -1;
	if (b == null) return 1;
	if (typeof a === "number" && typeof b === "number") return a - b;
	if (a instanceof Date && b instanceof Date) return a.getTime() - b.getTime();
	if (typeof a === "boolean" && typeof b === "boolean") return (a ? 1 : 0) - (b ? 1 : 0);
	return toText(a).localeCompare(toText(b), undefined, { numeric: true, sensitivity: "base" });
}

/**
 * Stable multi-column sort. Applies each active {@link SortState} in priority order; a `null`
 * direction is skipped. Returns a new array (input untouched).
 */
export function sortRows<T>(rows: T[], sorts: SortState[]): T[] {
	const active = sorts.filter((s) => s.dir);
	if (active.length === 0) return rows;
	const indexed = rows.map((row, i) => ({ row, i }));
	indexed.sort((x, y) => {
		for (const s of active) {
			const cmp = compareValues(getFieldValue(x.row, s.field), getFieldValue(y.row, s.field));
			if (cmp !== 0) return s.dir === "asc" ? cmp : -cmp;
		}
		return x.i - y.i;
	});
	return indexed.map((e) => e.row);
}

/** Cycle a column's sort direction: none → asc → desc → none. */
export function nextSortDir(dir: SortDir): SortDir {
	return dir === null ? "asc" : dir === "asc" ? "desc" : null;
}
// #endregion

// #region Filtering
/** Evaluate one {@link FilterConstraint} against a single cell value. */
export function matchesConstraint(value: unknown, constraint: FilterConstraint): boolean {
	const { matchMode, value: needle } = constraint;
	if (needle == null || needle === "") return true;
	const hay = toText(value).toLowerCase();
	const term = toText(needle).toLowerCase();

	switch (matchMode) {
		case "contains":
			return hay.includes(term);
		case "notContains":
			return !hay.includes(term);
		case "startsWith":
			return hay.startsWith(term);
		case "endsWith":
			return hay.endsWith(term);
		case "equals":
			return hay === term;
		case "notEquals":
			return hay !== term;
		case "lt":
			return compareValues(value, coerceLike(value, needle)) < 0;
		case "lte":
			return compareValues(value, coerceLike(value, needle)) <= 0;
		case "gt":
			return compareValues(value, coerceLike(value, needle)) > 0;
		case "gte":
			return compareValues(value, coerceLike(value, needle)) >= 0;
		case "in":
			return Array.isArray(needle)
				? needle.map((n) => toText(n).toLowerCase()).includes(hay)
				: false;
		case "between": {
			if (!Array.isArray(needle) || needle.length < 2) return true;
			return compareValues(value, needle[0]) >= 0 && compareValues(value, needle[1]) <= 0;
		}
		default:
			return true;
	}
}

/** Coerce a filter needle to the same primitive shape as the cell value for numeric comparisons. */
function coerceLike(sample: unknown, needle: unknown): unknown {
	if (typeof sample === "number") {
		const n = Number(needle);
		return Number.isNaN(n) ? needle : n;
	}
	return needle;
}

/** Apply every active column constraint (logical AND across columns). Returns a new array. */
export function filterRows<T>(
	rows: T[],
	filters: Record<string, FilterConstraint>,
	get: (row: T, field: string) => unknown,
): T[] {
	const entries = Object.entries(filters).filter(([, c]) => c && c.value != null && c.value !== "");
	if (entries.length === 0) return rows;
	return rows.filter((row) => entries.every(([field, c]) => matchesConstraint(get(row, field), c)));
}
// #endregion

// #region State persistence
/** Read a JSON blob previously saved under `stateKey` from localStorage (SSR/lookup-safe). */
export function loadState<S>(stateKey: string | undefined): Partial<S> | null {
	if (!stateKey || typeof localStorage === "undefined") return null;
	try {
		const raw = localStorage.getItem(stateKey);
		return raw ? JSON.parse(raw) as Partial<S> : null;
	} catch {
		return null;
	}
}

/** Persist a serialisable state blob under `stateKey` (no-op on the server or when quota fails). */
export function saveState<S>(stateKey: string | undefined, state: S): void {
	if (!stateKey || typeof localStorage === "undefined") return;
	try {
		localStorage.setItem(stateKey, JSON.stringify(state));
	} catch {
		// Ignore quota/serialisation failures — persistence is best-effort.
	}
}
// #endregion
