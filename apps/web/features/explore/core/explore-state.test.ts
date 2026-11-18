import { assertEquals } from "@std/assert";
import { parseExploreParams, serializeExploreParams, withQuery } from "./explore-state.ts";

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
