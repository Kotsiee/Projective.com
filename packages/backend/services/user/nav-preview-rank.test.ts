import { assertEquals } from "@std/assert";
import { instant, newestFirst, pinFirst } from "./nav-preview-rank.ts";

interface Row {
	id: string;
	at: string;
	pin?: string | null;
}

const rows: Row[] = [
	{ id: "old-pin", at: "2026-01-01T00:00:00Z", pin: "2026-10-01T00:00:00Z" },
	{ id: "fresh", at: "2026-11-03T10:00:00Z" },
	{ id: "new-pin", at: "2025-06-01T00:00:00Z", pin: "2026-11-01T00:00:00+00:00" },
	{ id: "warm", at: "2026-11-02T10:00:00Z" },
	{ id: "untimed-pin", at: "2026-11-03T09:00:00Z", pin: null },
	{ id: "cold", at: "2026-01-01T00:00:00Z" },
];
const pinOf = (r: Row) => r.pin;
const byRecent = newestFirst<Row>((r) => r.at);
const ids = (out: Row[]) => out.map((r) => r.id);

Deno.test("pinned rows outrank recency, newest pin first, untimed pins after timed ones", () => {
	assertEquals(ids(pinFirst(rows, pinOf, byRecent, 6)), [
		"new-pin",
		"old-pin",
		"untimed-pin",
		"fresh",
		"warm",
		"cold",
	]);
});

Deno.test("pinFirst keeps three by default and fills spare slots with the ranking", () => {
	assertEquals(ids(pinFirst(rows, pinOf, byRecent)), ["new-pin", "old-pin", "untimed-pin"]);
	const onePin = rows.filter((r) => r.id !== "old-pin" && r.id !== "untimed-pin");
	assertEquals(ids(pinFirst(onePin, pinOf, byRecent)), ["new-pin", "fresh", "warm"]);
	assertEquals(pinFirst([], pinOf, byRecent), []);
});

Deno.test("instant reads both ISO spellings and treats the unknown as oldest", () => {
	assertEquals(instant("2026-11-01T00:00:00Z"), instant("2026-11-01T00:00:00+00:00"));
	assertEquals(instant(null), 0);
	assertEquals(instant("not a date"), 0);
});
