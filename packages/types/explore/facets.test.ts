import { assertEquals } from "@std/assert";
import {
	type Facet,
	facetIsDefault,
	FacetSchema,
	mergeFacets,
	milestoneFacetValue,
	type MilestonesFacet,
	normaliseFacetValues,
	type RangeFacet,
	rangeFacetValue,
	ratingFacetValue,
} from "./facets.ts";

/**
 * The facet helpers are the one place "is this filter set" is decided, and three surfaces read the
 * answer — the reset control, the active-count badge and the URL serialiser. A second derivation in
 * any of them would let a reset button offer to undo a filter the URL no longer carries.
 */

const price = FacetSchema.parse({
	id: "price",
	label: "Price",
	control: "range",
	min: 0,
	max: 500,
	step: 10,
	symbol: "$",
}) as RangeFacet;
const rating: Facet = FacetSchema.parse({ id: "rating", label: "Rating", control: "rating" });
const delivery = FacetSchema.parse({
	id: "delivery",
	label: "Delivery",
	control: "milestones",
	milestones: [
		{ value: 1, label: "Same day" },
		{ value: 7, label: "1 week" },
		{ value: 90, label: "3 months" },
	],
}) as MilestonesFacet;
const skill: Facet = FacetSchema.parse({
	id: "skill",
	label: "Skills",
	control: "chips",
	options: [{ value: "design", label: "Design" }],
});

// #region Defaults
Deno.test("an absent or empty selection is the default for every facet kind", () => {
	for (const f of [price, rating, delivery, skill]) {
		assertEquals(facetIsDefault(f, undefined), true);
		assertEquals(facetIsDefault(f, []), true);
	}
});

Deno.test("a range at its own bounds, a rating of zero and the loosest milestone are defaults too", () => {
	assertEquals(facetIsDefault(price, ["0", "500"]), true);
	assertEquals(facetIsDefault(price, ["0", "400"]), false);
	assertEquals(facetIsDefault(rating, ["0"]), true);
	assertEquals(facetIsDefault(rating, ["3.5"]), false);
	assertEquals(facetIsDefault(delivery, ["90"]), true);
	assertEquals(facetIsDefault(delivery, ["7"]), false);
	assertEquals(facetIsDefault(skill, ["design"]), false);
});
// #endregion

// #region Value readers
Deno.test("rangeFacetValue orders, clamps, and reads the legacy single 'up to' form", () => {
	assertEquals(rangeFacetValue(price, ["400", "100"]), [100, 400]);
	assertEquals(rangeFacetValue(price, ["-5", "9999"]), [0, 500]);
	assertEquals(rangeFacetValue(price, ["250"]), [0, 250]);
	assertEquals(rangeFacetValue(price, ["abc"]), [0, 500]);
	assertEquals(rangeFacetValue(price, undefined), [0, 500]);
});

Deno.test("ratingFacetValue is zero for anything that is not a positive number", () => {
	assertEquals(ratingFacetValue(["4.5"]), 4.5);
	assertEquals(ratingFacetValue(["-1"]), 0);
	assertEquals(ratingFacetValue(["x"]), 0);
	assertEquals(ratingFacetValue(undefined), 0);
});

Deno.test("milestoneFacetValue snaps to a real stop and defaults to the last one", () => {
	assertEquals(milestoneFacetValue(delivery, ["8"]), 7);
	assertEquals(milestoneFacetValue(delivery, ["1000"]), 90);
	assertEquals(milestoneFacetValue(delivery, undefined), 90);
});
// #endregion

// #region Normalisation
Deno.test("normaliseFacetValues collapses a default to the empty list and tidies the rest", () => {
	assertEquals(normaliseFacetValues(price, ["0", "500"]), []);
	assertEquals(normaliseFacetValues(price, ["400", "100"]), ["100", "400"]);
	assertEquals(normaliseFacetValues(rating, ["7"]), ["5"]);
	assertEquals(normaliseFacetValues(delivery, ["8"]), ["7"]);
	assertEquals(normaliseFacetValues(delivery, ["90"]), []);
	assertEquals(normaliseFacetValues(skill, ["design", "motion"]), ["design", "motion"]);
});
// #endregion

// #region Merge
Deno.test("mergeFacets lets a runtime facet replace a static one by id and appends the rest in order", () => {
	const dynamicRating: Facet = FacetSchema.parse({
		id: "rating",
		label: "Seller rating",
		control: "rating",
		stars: 5,
		precision: 1,
	});
	const accent: Facet = FacetSchema.parse({
		id: "accent",
		label: "Accent",
		control: "multiselect",
		options: [{ value: "rp", label: "Received Pronunciation" }],
	});
	const merged = mergeFacets([price, rating, skill], [accent, dynamicRating]);
	assertEquals(merged.map((f) => f.id), ["price", "rating", "skill", "accent"]);
	assertEquals(merged[1].label, "Seller rating");
	assertEquals(mergeFacets([price]), [price]);
});
// #endregion
