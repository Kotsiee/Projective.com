import { assert, assertEquals } from "jsr:@std/assert@^1";
import type { ProjectSummary } from "@projective/types/projects";
import { allProjects } from "./fixtures.ts";
import { applySort } from "./query.ts";

const rows: readonly ProjectSummary[] = allProjects();

function ids(list: readonly ProjectSummary[]): string[] {
	return list.map((r) => r.id);
}

Deno.test("query.applySort: the natural direction is the default", () => {
	assertEquals(ids(applySort(rows, "recent", "desc")), ids(applySort(rows, "recent")));
	assertEquals(ids(applySort(rows, "alphabetical", "asc")), ids(applySort(rows, "alphabetical")));
	assertEquals(ids(applySort(rows, "priority", "desc")), ids(applySort(rows, "priority")));
});

Deno.test("query.applySort: recent ascending puts the oldest first", () => {
	const out = applySort(rows, "recent", "asc");
	for (let i = 1; i < out.length; i++) {
		assert(out[i - 1].updatedAt.localeCompare(out[i].updatedAt) <= 0);
	}
});

Deno.test("query.applySort: alphabetical descending runs Z–A", () => {
	const out = applySort(rows, "alphabetical", "desc");
	for (let i = 1; i < out.length; i++) {
		assert(out[i - 1].title.localeCompare(out[i].title) >= 0);
	}
});

Deno.test("query.applySort: ties keep the ascending id order in either direction", () => {
	const twin = (id: string): ProjectSummary => ({
		...rows[0],
		id,
		title: "Same",
		updatedAt: rows[0].updatedAt,
	});
	const pair = [twin("b"), twin("a")];
	assertEquals(ids(applySort(pair, "alphabetical", "asc")), ["a", "b"]);
	assertEquals(ids(applySort(pair, "alphabetical", "desc")), ["a", "b"]);
});

Deno.test("query.applySort: never mutates its input", () => {
	const before = ids(rows);
	applySort(rows, "alphabetical", "desc");
	assertEquals(ids(rows), before);
});
