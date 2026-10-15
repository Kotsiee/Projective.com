import { assertEquals } from "@std/assert";
import type { DataColumn } from "../types/data-table.ts";
import { nextSorts, sortKeyOf, sortRowsBy } from "./table-sort.ts";

interface Row {
	id: string;
	name: string;
	size: number | null;
	at: string;
}

const columns: DataColumn<Row>[] = [
	{ id: "name", header: "Name", type: "text", value: (r) => r.name },
	{ id: "size", header: "Size", type: "fileSize", value: (r) => r.size },
	{ id: "at", header: "Edited", type: "date", value: (r) => r.at, sortKey: "recent" },
	{ id: "thumb", header: "Preview", type: "image", value: () => null },
];

const rows: Row[] = [
	{ id: "1", name: "beta", size: 20, at: "2026-01-03" },
	{ id: "2", name: "Alpha", size: null, at: "2026-01-01" },
	{ id: "3", name: "gamma", size: 20, at: "2026-01-02" },
	{ id: "4", name: "alpha 10", size: 5, at: "2026-01-04" },
	{ id: "5", name: "alpha 9", size: 5, at: "2026-01-05" },
];
const idsOf = (list: Row[]) => list.map((r) => r.id);

// #region sortKeyOf
Deno.test("a column sorts under its id, its sortKey, or not at all", () => {
	assertEquals(sortKeyOf(columns[0]), "name");
	assertEquals(sortKeyOf(columns[2]), "recent");
	assertEquals(sortKeyOf(columns[3]), null);
	assertEquals(sortKeyOf({ ...columns[0], sortKey: null }), null);
});
// #endregion

// #region nextSorts
Deno.test("a plain click cycles asc → desc → none under the three-state cycle", () => {
	const opts = { append: false, cycle: "asc-desc-none" as const };
	const a = nextSorts([], "name", opts);
	assertEquals(a, [{ key: "name", dir: "asc" }]);
	const d = nextSorts(a, "name", opts);
	assertEquals(d, [{ key: "name", dir: "desc" }]);
	assertEquals(nextSorts(d, "name", opts), []);
});

Deno.test("the two-state cycle never clears", () => {
	const opts = { append: false, cycle: "asc-desc" as const };
	assertEquals(nextSorts([{ key: "name", dir: "desc" }], "name", opts), [{
		key: "name",
		dir: "asc",
	}]);
});

Deno.test("a column's first click can start descending", () => {
	const opts = { append: false, cycle: "asc-desc-none" as const, firstDir: "desc" as const };
	const first = nextSorts([], "recent", opts);
	assertEquals(first, [{ key: "recent", dir: "desc" }]);
	assertEquals(nextSorts(first, "recent", opts), [{ key: "recent", dir: "asc" }]);
	assertEquals(nextSorts([{ key: "recent", dir: "asc" }], "recent", opts), []);
});

Deno.test("a plain click on another column replaces the sort", () => {
	assertEquals(
		nextSorts([{ key: "name", dir: "asc" }, { key: "size", dir: "desc" }], "recent", {
			append: false,
			cycle: "asc-desc-none",
		}),
		[{ key: "recent", dir: "asc" }],
	);
});

Deno.test("a plain click on a column of a multi-sort keeps only that column", () => {
	assertEquals(
		nextSorts([{ key: "name", dir: "asc" }, { key: "size", dir: "desc" }], "size", {
			append: false,
			cycle: "asc-desc-none",
		}),
		[{ key: "size", dir: "desc" }],
	);
});

Deno.test("Shift+click appends, steps in place, then removes", () => {
	const opts = { append: true, cycle: "asc-desc-none" as const };
	const two = nextSorts([{ key: "name", dir: "asc" }], "size", opts);
	assertEquals(two, [{ key: "name", dir: "asc" }, { key: "size", dir: "asc" }]);
	const stepped = nextSorts(two, "size", opts);
	assertEquals(stepped, [{ key: "name", dir: "asc" }, { key: "size", dir: "desc" }]);
	assertEquals(nextSorts(stepped, "size", opts), [{ key: "name", dir: "asc" }]);
});
// #endregion

// #region sortRowsBy
Deno.test("text sorts naturally and case-insensitively", () => {
	assertEquals(idsOf(sortRowsBy(rows, [{ key: "name", dir: "asc" }], columns)), [
		"2",
		"5",
		"4",
		"1",
		"3",
	]);
});

Deno.test("empty values sort last in both directions", () => {
	assertEquals(idsOf(sortRowsBy(rows, [{ key: "size", dir: "asc" }], columns)).at(-1), "2");
	assertEquals(idsOf(sortRowsBy(rows, [{ key: "size", dir: "desc" }], columns)).at(-1), "2");
});

Deno.test("multi-key sorts break ties in priority order and stay stable", () => {
	assertEquals(
		idsOf(
			sortRowsBy(rows, [{ key: "size", dir: "desc" }, { key: "recent", dir: "desc" }], columns),
		),
		["1", "3", "5", "4", "2"],
	);
});

Deno.test("dates sort by instant under their sortKey; unknown keys leave the order alone", () => {
	assertEquals(idsOf(sortRowsBy(rows, [{ key: "recent", dir: "asc" }], columns)), [
		"2",
		"3",
		"1",
		"4",
		"5",
	]);
	assertEquals(idsOf(sortRowsBy(rows, [{ key: "nope", dir: "asc" }], columns)), [
		"1",
		"2",
		"3",
		"4",
		"5",
	]);
});
// #endregion
