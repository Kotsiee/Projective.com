import { assertEquals } from "@std/assert";
import { facetValueLabel } from "./filter-config.ts";

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
