import { assertEquals, assertRejects } from "@std/assert";
import { PAGE_ROWS, type PageReader, readAllPages } from "./live-catalog.ts";

// #region Fake paged source
/** A table of `count` rows behind a reader that, like PostgREST, never returns more than PAGE_ROWS. */
function pagedTable(count: number): { read: PageReader; calls: Array<string | null> } {
	const rows = Array.from(
		{ length: count },
		(_, i) => ({ id: `row-${String(i).padStart(6, "0")}` }),
	);
	const calls: Array<string | null> = [];
	const read: PageReader = (after, limit) => {
		calls.push(after);
		const from = after === null ? 0 : rows.findIndex((r) => r.id > after);
		const data = from < 0 ? [] : rows.slice(from, from + Math.min(limit, PAGE_ROWS));
		return Promise.resolve({ data, error: null });
	};
	return { read, calls };
}
// #endregion

Deno.test("readAllPages — loads every row past the 1,000-row cap", async () => {
	const { read, calls } = pagedTable(2_500);
	const rows = await readAllPages<{ id: string }>("t", "id", read);
	assertEquals(rows.length, 2_500);
	assertEquals(new Set(rows.map((r) => r.id)).size, 2_500);
	assertEquals(calls, [null, "row-000999", "row-001999"]);
});

Deno.test("readAllPages — an exact multiple of the cap ends on an empty page", async () => {
	const { read, calls } = pagedTable(2 * PAGE_ROWS);
	assertEquals((await readAllPages<{ id: string }>("t", "id", read)).length, 2 * PAGE_ROWS);
	assertEquals(calls.length, 3);
});

Deno.test("readAllPages — a page error fails the load instead of truncating it", async () => {
	const read: PageReader = (after) =>
		Promise.resolve(
			after === null
				? { data: Array.from({ length: PAGE_ROWS }, (_, i) => ({ id: `r${i}` })), error: null }
				: { data: null, error: { message: "boom" } },
		);
	await assertRejects(() => readAllPages<{ id: string }>("t", "id", read), Error, "boom");
});
