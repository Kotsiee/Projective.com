import { assert, assertEquals } from "@std/assert";
import {
	decodeOrderCursor,
	encodeOrderCursor,
	type HistoryRequest,
	type KeysetQuery,
	readHistoryRows,
} from "./order-history.ts";

// #region Fixture
interface Row {
	id: string;
	placed_at: string;
}

/** `n` orders, newest last, placed two to an instant, so the id has to break every tie. */
function orders(n: number): Row[] {
	return Array.from({ length: n }, (_, i) => {
		const day = Math.floor(i / 2) + 1;
		return {
			id: `00000000-0000-4000-8000-${String(i + 1).padStart(12, "0")}`,
			placed_at: `2026-10-${String(day).padStart(2, "0")}T09:30:00.123456+00:00`,
		};
	});
}

/** Compare two rows on (placed_at, id). The fixture's instants share one format, so text order is time order. */
function compare(a: Row, b: Row): number {
	return a.placed_at < b.placed_at
		? -1
		: a.placed_at > b.placed_at
		? 1
		: a.id < b.id
		? -1
		: a.id > b.id
		? 1
		: 0;
}

/**
 * An in-memory stand-in for PostgREST's builder that understands exactly the keyset filter the reader
 * sends: `placed_at.<op>."<t>",and(placed_at.eq."<t>",id.<op>.<id>)`. Anything else is a test failure,
 * so a reader that drifts from that shape cannot pass by accident.
 */
function fakeQuery(rows: readonly Row[], seen: string[] = []): KeysetQuery<Row> {
	let filter: ((row: Row) => boolean) | null = null;
	const sorts: { column: string; ascending: boolean }[] = [];
	const query: KeysetQuery<Row> = {
		or(expr) {
			seen.push(expr);
			const m = expr.match(
				/^placed_at\.(lt|gt)\."([^"]+)",and\(placed_at\.eq\."([^"]+)",id\.(lt|gt)\.([0-9a-f-]{36})\)$/,
			);
			assert(m, `unexpected keyset filter: ${expr}`);
			const [, op, t, t2, idOp, id] = m;
			assertEquals(t, t2);
			assertEquals(op, idOp);
			const pivot = { placed_at: t, id };
			filter = (row) => op === "lt" ? compare(row, pivot) < 0 : compare(row, pivot) > 0;
			return query;
		},
		order(column, options) {
			sorts.push({ column, ...options });
			return query;
		},
		limit(count) {
			const kept = rows.filter((row) => (filter ? filter(row) : true));
			const sorted = [...kept].sort((a, b) => {
				for (const s of sorts) {
					const c = s.column === "placed_at"
						? compare({ ...a, id: "" }, { ...b, id: "" })
						: a.id < b.id
						? -1
						: a.id > b.id
						? 1
						: 0;
					if (c !== 0) return s.ascending ? c : -c;
				}
				return 0;
			});
			return Promise.resolve({ data: sorted.slice(0, count), error: null });
		},
	};
	return query;
}

/** Every id reachable from the newest page by following `older` to the end. */
async function pageThrough(rows: readonly Row[], limit = 20): Promise<string[][]> {
	const pages: string[][] = [];
	let request: HistoryRequest = { cursor: null, direction: "older", limit };
	for (let guard = 0; guard < 50; guard++) {
		const window = await readHistoryRows(fakeQuery(rows), request);
		pages.push(window.rows.map((r) => r.id));
		const next = decodeOrderCursor(window.older);
		if (!next) break;
		request = { cursor: next, direction: "older", limit };
	}
	return pages;
}
// #endregion

// #region Reach
Deno.test("a buyer's 21st order is reachable: paging the history lists all 25, each once, newest first", async () => {
	const rows = orders(25);
	const pages = await pageThrough(rows);
	const reached = pages.flat();
	const expected = [...rows].sort((a, b) => compare(b, a)).map((r) => r.id);
	assertEquals(
		reached.length,
		25,
		`only ${reached.length} of 25 orders are reachable from any list`,
	);
	assertEquals(reached, expected);
	assertEquals(pages.map((p) => p.length), [20, 5]);
});

Deno.test("a page boundary inside a tie on placed_at neither skips nor repeats the tied order", async () => {
	const rows = orders(9);
	const reached = (await pageThrough(rows, 2)).flat();
	assertEquals(new Set(reached).size, 9);
	assertEquals(reached, [...rows].sort((a, b) => compare(b, a)).map((r) => r.id));
});

Deno.test("newer walks back from the last page to the first, which has no newer page", async () => {
	const rows = orders(25);
	const first = await readHistoryRows(fakeQuery(rows), {
		cursor: null,
		direction: "older",
		limit: 20,
	});
	assertEquals(first.newer, null);
	const second = await readHistoryRows(fakeQuery(rows), {
		cursor: decodeOrderCursor(first.older),
		direction: "older",
		limit: 20,
	});
	assertEquals(second.older, null);
	const back = await readHistoryRows(fakeQuery(rows), {
		cursor: decodeOrderCursor(second.newer),
		direction: "newer",
		limit: 20,
	});
	assertEquals(back.rows.map((r) => r.id), first.rows.map((r) => r.id));
	assertEquals(back.newer, null);
	assert(back.older !== null);
});

Deno.test("an account with no orders reads one empty page with no neighbours", async () => {
	const window = await readHistoryRows(fakeQuery([]), {
		cursor: null,
		direction: "older",
		limit: 20,
	});
	assertEquals(window, { rows: [], older: null, newer: null });
});

Deno.test("the newest page sends no filter; a later page sends the keyset, never an offset", async () => {
	const rows = orders(25);
	const seen: string[] = [];
	const first = await readHistoryRows(fakeQuery(rows, seen), {
		cursor: null,
		direction: "older",
		limit: 20,
	});
	assertEquals(seen, []);
	await readHistoryRows(fakeQuery(rows, seen), {
		cursor: decodeOrderCursor(first.older),
		direction: "older",
		limit: 20,
	});
	assertEquals(seen.length, 1);
	assert(seen[0].startsWith('placed_at.lt."2026-'));
});
// #endregion

// #region Cursor
Deno.test("a cursor round-trips with its microseconds and offset intact", () => {
	const cursor = {
		placedAt: "2026-11-19T00:12:34.123456+00:00",
		id: "0f1e2d3c-4b5a-4987-8a6b-5c4d3e2f1a0b",
	};
	const token = encodeOrderCursor(cursor);
	assert(/^[A-Za-z0-9_-]+$/.test(token), "the token is URL-safe");
	assertEquals(decodeOrderCursor(token), cursor);
});

Deno.test("a token this module did not write decodes to nothing", () => {
	for (
		const raw of [
			null,
			"",
			"not base64!",
			encodeOrderCursor({ placedAt: "yesterday", id: "0f1e2d3c-4b5a-4987-8a6b-5c4d3e2f1a0b" }),
			encodeOrderCursor({ placedAt: "2026-11-19T00:12:34Z", id: "1 OR 1=1" }),
			encodeOrderCursor({
				placedAt: '2026-11-19T00:12:34Z",id.gt.0',
				id: "0f1e2d3c-4b5a-4987-8a6b-5c4d3e2f1a0b",
			}),
		]
	) {
		assertEquals(decodeOrderCursor(raw), null, String(raw));
	}
});
// #endregion
