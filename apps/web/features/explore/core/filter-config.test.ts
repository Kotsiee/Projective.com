import { assertEquals } from "@std/assert";
import { ExploreSort } from "@projective/types/explore";
import { facetValueLabel, SORT_OPTIONS, sortOptionsFor } from "./filter-config.ts";

Deno.test("the sort menu labels every order, and offers Best match only with a query", () => {
	assertEquals(SORT_OPTIONS.map((o) => o.value), [...ExploreSort.options]);
	assertEquals(sortOptionsFor("logo")[0], { value: "best_match", label: "Best match" });
	assertEquals(
		sortOptionsFor("  ").map((o) => o.value),
		["recommended", "rating", "price_asc", "newest"],
	);
});

Deno.test("facetValueLabel prints the filter chip's own word for a stored value", () => {
	assertEquals(facetValueLabel("services", "cat", "web"), "Web");
	assertEquals(facetValueLabel("products", "cat", "ui-kit"), "UI kits");
	assertEquals(facetValueLabel("articles", "topic", "getting-started"), "Getting started");
});

Deno.test("facetValueLabel humanises a value no option names", () => {
	assertEquals(facetValueLabel("services", "cat", "sound-design"), "Sound design");
	assertEquals(facetValueLabel("services", "missing", "brand_strategy"), "Brand strategy");
	assertEquals(facetValueLabel("services", "cat", ""), "");
});
