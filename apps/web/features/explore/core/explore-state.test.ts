import { assert, assertEquals } from "@std/assert";
import { EXPLORE_QUERY_MAX } from "@projective/types/explore";
import {
	canonicalExploreHref,
	EXPLORE_FACET_KEYS,
	inspectExploreQuery,
	parseExploreParams,
	serializeExploreParams,
	withQuery,
} from "./explore-state.ts";
import { FILTER_CONFIG } from "./filter-config.ts";

/**
 * The `?sort=` contract: a typed search defaults to Best match and a browse to Recommended, the
 * default is never written to the URL, and a sort the reader picked survives a new query.
 */

Deno.test("with no ?sort=, a query takes Best match and a browse takes Recommended", () => {
	assertEquals(parseExploreParams("?q=logo").sort, "best_match");
	assertEquals(parseExploreParams("?category=services").sort, "recommended");
	assertEquals(parseExploreParams("?q=%20%20").sort, "recommended");
});

Deno.test("an explicit sort is kept, and Best match without a query reads as Recommended", () => {
	assertEquals(parseExploreParams("?q=logo&sort=recommended").sort, "recommended");
	assertEquals(parseExploreParams("?q=logo&sort=price_asc").sort, "price_asc");
	assertEquals(parseExploreParams("?category=services&sort=best_match").sort, "recommended");
});

Deno.test("the default order is never written; any other order is", () => {
	assertEquals(serializeExploreParams(parseExploreParams("?q=logo")), "/explore?q=logo");
	assertEquals(
		serializeExploreParams(parseExploreParams("?q=logo&sort=recommended")),
		"/explore?q=logo&sort=recommended",
	);
	assertEquals(
		serializeExploreParams(parseExploreParams("?category=services&sort=best_match")),
		"/explore?category=services",
	);
	assertEquals(
		serializeExploreParams({ q: "", category: "all", sort: "best_match", filters: {} }),
		"/explore",
	);
});

Deno.test("a new query moves a default order to the new default and keeps a picked one", () => {
	const browsing = parseExploreParams("?category=services");
	assertEquals(withQuery(browsing, "logo").sort, "best_match");
	const searching = parseExploreParams("?q=logo");
	assertEquals(withQuery(searching, "brand").sort, "best_match");
	assertEquals(withQuery(searching, "").sort, "recommended");
	const picked = parseExploreParams("?q=logo&sort=rating");
	assertEquals(withQuery(picked, "brand").sort, "rating");
	const pickedRecommended = parseExploreParams("?q=logo&sort=recommended");
	assertEquals(withQuery(pickedRecommended, "brand").sort, "recommended");
	assertEquals(withQuery(searching, "  brand ").q, "brand");
});

// #region The doors (COMMS SR2, CAS S37)
Deno.test("a q of 513 characters is a problem, cut to 512; 512 is not", () => {
	const long = inspectExploreQuery(`?q=${"a".repeat(513)}`, "api");
	assertEquals(Object.keys(long.problems), ["q"]);
	assertEquals(long.params.q.length, EXPLORE_QUERY_MAX);
	assertEquals(inspectExploreQuery(`?q=${"a".repeat(512)}`, "api").problems, {});
});

Deno.test("an unknown filter key never reaches the params; a whitelisted one does", () => {
	const query = inspectExploreQuery("?q=logo&skill=design&utm_source=x&colour=red&offset=18");
	assertEquals(query.params.filters, { skill: ["design"] });
	assertEquals(Object.keys(query.problems).sort(), ["colour", "offset"], "offset is the API's");
	assertEquals(
		inspectExploreQuery("?q=logo&colour=red", "api").problems.colour !== undefined,
		true,
	);
});

Deno.test("an unknown order or category, a long facet value and too many values are corrected", () => {
	const query = inspectExploreQuery(
		`?q=logo&sort=cheapest&category=widgets&skill=${"x".repeat(65)},design&cat=${
			Array.from({ length: 21 }, (_, n) => `c${n}`).join(",")
		}`,
	);
	assertEquals(Object.keys(query.problems).sort(), ["cat", "category", "skill", "sort"]);
	assertEquals(query.params.sort, "best_match");
	assertEquals(query.params.category, "all");
	assertEquals(query.params.filters.skill, ["design"]);
	assertEquals(query.params.filters.cat.length, 20);
});

Deno.test("the API's offset and limit are whole numbers in bounds, else a problem", () => {
	assertEquals(inspectExploreQuery("?offset=18&limit=18", "api").offset, 18);
	assertEquals(inspectExploreQuery("?offset=18&limit=18", "api").limit, 18);
	for (
		const qs of [
			"?offset=-1",
			"?offset=1.5",
			"?offset=10001",
			"?limit=0",
			"?limit=61",
			"?limit=x",
			"?offset=",
		]
	) {
		assert(Object.keys(inspectExploreQuery(qs, "api").problems).length === 1, qs);
	}
});

Deno.test("the canonical address keeps the drawer, overlay and campaign keys, and drops the rest", () => {
	const arrived = new URLSearchParams(
		`?q=${"b".repeat(600)}&colour=red&item=svc-1&settings=account&feedback=open&utm_source=mail`,
	);
	const query = inspectExploreQuery(arrived);
	assertEquals(
		canonicalExploreHref(query.params, arrived),
		`/explore?q=${"b".repeat(512)}&item=svc-1&settings=account&feedback=open&utm_source=mail`,
	);
});

Deno.test("the facet whitelist is exactly the ids the sidebar's facet lists declare", () => {
	const declared = new Set(
		Object.values(FILTER_CONFIG).flatMap((facets) => facets.map((f) => f.id)),
	);
	assertEquals([...declared].sort(), [...EXPLORE_FACET_KEYS].sort());
});
// #endregion
