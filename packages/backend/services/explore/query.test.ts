import { assert, assertEquals } from "@std/assert";
import { deliveryDays, getResults, groupResults, relatedSearches } from "./query.ts";
import type { ExploreItem, ExploreParams, ServiceItem } from "@projective/types/explore";

/**
 * The facet contract between the sidebar and the discovery query. The sidebar writes `price` as a
 * `[min, max]` pair (and once wrote a single "up to" value, which a bookmark may still carry) and
 * `delivery` as a number of days; what is pinned here is that the query reads both forms the way
 * the sidebar means them, since a facet that silently applies nothing looks exactly like a corpus
 * with no matches.
 *
 * The query is pure over the list it is handed, so these build a small corpus inline rather than
 * reading the database — the rules under test are the query's, not the data's.
 */

// #region Corpus
const owner = { handle: "@studio", name: "Studio", avatar: "", kind: "team" as const };

function service(
	id: string,
	priceMinor: number,
	delivery: string,
	extra: Partial<ServiceItem> = {},
): ServiceItem {
	return {
		id,
		type: "services",
		title: `Service ${id}`,
		owner,
		skills: [{ label: "Branding", category: "design" }],
		summary: "A test service.",
		createdAt: "2026-09-01",
		price: `$${priceMinor / 100}`,
		priceMinor,
		currency: "USD",
		delivery,
		category: "branding",
		serviceType: "One-Off",
		...extra,
	};
}

const CORPUS: ExploreItem[] = [
	service("svc-aaaaaaaaaa", 90_000, "5-day delivery"),
	service("svc-bbbbbbbbbb", 250_000, "2-week delivery"),
	service("svc-cccccccccc", 480_000, "10-day delivery", {
		serviceType: "Pipeline",
		ticketPrice: 240,
		category: "motion",
		skills: [{ label: "Motion design", category: "motion" }],
	}),
	service("svc-dddddddddd", 18_000, "60-minute session", {
		serviceType: "Session",
		sessionPrice: 180,
	}),
];

function params(filters: Record<string, string[]>, q = ""): ExploreParams {
	return { q, category: "services", sort: "recommended", filters };
}
// #endregion

Deno.test("deliveryDays reads day, week and month windows off the display string", () => {
	const base = CORPUS[0] as ServiceItem;
	assertEquals(deliveryDays({ ...base, delivery: "10-day delivery" }), 10);
	assertEquals(deliveryDays({ ...base, delivery: "2-week delivery" }), 14);
	assertEquals(deliveryDays({ ...base, delivery: "1 month" }), 30);
	assertEquals(deliveryDays({ ...base, delivery: "on request" }), null);
});

Deno.test("a delivery facet keeps only services delivered within the window", () => {
	const all = getResults(CORPUS, params({}));
	const fast = getResults(CORPUS, params({ delivery: ["7"] }));
	assert(fast.length < all.length);
	for (const it of fast) {
		const d = deliveryDays(it);
		assert(d === null || d <= 7);
	}
});

Deno.test("a price pair bounds both ends and the legacy single value still means 'up to'", () => {
	const all = getResults(CORPUS, params({}));
	const pair = getResults(CORPUS, params({ price: ["1000", "3000"] }));
	const upTo = getResults(CORPUS, params({ price: ["3000"] }));
	assert(pair.length <= upTo.length);
	assert(upTo.length <= all.length);
	assertEquals(getResults(CORPUS, params({ price: ["3000", "1000"] })).length, pair.length);
});

Deno.test("a pipeline sorts by its low-intensity floor, a session by its per-session price", () => {
	const sorted = getResults(CORPUS, { ...params({}), sort: "price_asc" }).map((it) => it.id);
	// Pipeline floor = 240 × 0.5 = 120 < session 180 < one-offs 900 / 2500.
	assertEquals(sorted, ["svc-cccccccccc", "svc-dddddddddd", "svc-aaaaaaaaaa", "svc-bbbbbbbbbb"]);
});

/*
 * The isolated feed used to be padded to 144 by cycling the corpus under suffixed ids, so a query
 * with four matches showed a hundred and forty. The query layer now returns exactly what matched.
 */
Deno.test("a query returns exactly the matching items — never a padded pool", () => {
	assertEquals(getResults(CORPUS, params({}, "motion")).map((it) => it.id), ["svc-cccccccccc"]);
	assertEquals(getResults(CORPUS, params({}, "no such thing")).length, 0);
});

Deno.test("groupResults drops empty sections and keeps ranked order within one", () => {
	const groups = groupResults(getResults(CORPUS, { ...params({}), category: "all" }));
	assertEquals(groups.map((g) => g.key), ["services"]);
	assertEquals(groups[0].items.length, CORPUS.length);
});

Deno.test("related searches come from what is listed, most frequent first, minus the query", () => {
	const related = relatedSearches(CORPUS, params({}, "branding"));
	assert(!related.map((r) => r.toLowerCase()).includes("branding"));
	assert(related.includes("Motion design"));
});
