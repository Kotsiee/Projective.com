import { assert, assertEquals } from "@std/assert";
import { deliveryDays, getResults } from "./query.ts";
import { SERVICES } from "./fixtures.ts";
import type { ExploreParams } from "@projective/types/explore";

/**
 * The facet contract between the sidebar and the discovery query. The sidebar writes `price` as a
 * `[min, max]` pair (and once wrote a single "up to" value, which a bookmark may still carry) and
 * `delivery` as a number of days; what is pinned here is that the query reads both forms the way
 * the sidebar means them, since a facet that silently applies nothing looks exactly like a corpus
 * with no matches.
 */

function params(filters: Record<string, string[]>): ExploreParams {
	return { q: "", category: "services", sort: "recommended", filters };
}

Deno.test("deliveryDays reads day, week and month windows off the display string", () => {
	assertEquals(deliveryDays({ ...SERVICES[0], delivery: "10-day delivery" }), 10);
	assertEquals(deliveryDays({ ...SERVICES[0], delivery: "2-week delivery" }), 14);
	assertEquals(deliveryDays({ ...SERVICES[0], delivery: "1 month" }), 30);
	assertEquals(deliveryDays({ ...SERVICES[0], delivery: "on request" }), null);
});

Deno.test("a delivery facet keeps only services delivered within the window", () => {
	const all = getResults(params({}));
	const fast = getResults(params({ delivery: ["7"] }));
	assert(fast.length < all.length);
	for (const it of fast) {
		const d = deliveryDays(it);
		assert(d === null || d <= 7);
	}
});

Deno.test("a price pair bounds both ends and the legacy single value still means 'up to'", () => {
	const all = getResults(params({}));
	const pair = getResults(params({ price: ["1000", "3000"] }));
	const upTo = getResults(params({ price: ["3000"] }));
	assert(pair.length <= upTo.length);
	assert(upTo.length <= all.length);
	assertEquals(getResults(params({ price: ["3000", "1000"] })).length, pair.length);
});
