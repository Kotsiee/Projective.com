import { assert, assertEquals } from "@std/assert";
import { fixtureConverter, fixtureOverview, fixtureScopedListings } from "./analytics-fixtures.ts";

const NOW = new Date("2026-10-14T12:00:00Z");

Deno.test("fixture catalogue spans several currencies, so a console read is mixed", () => {
	const currencies = new Set(fixtureScopedListings().map((l) => l.currency));
	assert(currencies.size > 1, `expected mixed currencies, got ${[...currencies]}`);
});

Deno.test("fixtureConverter — identity, cross rates, minor units and unknown currencies", () => {
	assertEquals(fixtureConverter(12_345, "USD", "USD"), 12_345);
	assertEquals(fixtureConverter(10_000, "USD", "GBP"), 7_900);
	// JPY has no minor unit: ¥15,000 is 15000 minor and $100.00 at 150.
	assertEquals(fixtureConverter(15_000, "JPY", "USD"), 10_000);
	assertEquals(fixtureConverter(100, "XXX", "USD"), null);
});

Deno.test("a mixed-currency rich read converts every listing's gross — none with orders reads 0", () => {
	const read = fixtureOverview({ kind: "catalogue", filter: "all" }, "90d", "rich", "USD", NOW);
	assert(read, "the console read answered nothing");
	assertEquals(read.currency, "USD");
	const ordered = read.topListings.filter((row) => row.orders > 0);
	assert(ordered.length > 1, "the rich fixture should sell more than one listing");
	for (const row of ordered) assert(row.gross > 0, `${row.title}: ${row.orders} orders, gross 0`);
});
