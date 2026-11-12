import { assertEquals } from "@std/assert";
import { CLIENT_STAGE_TERMS, STAGE_TERM_COLUMNS, stageTermsOf } from "./stage-terms.ts";

Deno.test("stageTermsOf reads a seller's locked stage, its tier prices dropped", () => {
	assertEquals(
		stageTermsOf({
			default_intensity: "high",
			intensity_locked: true,
			low_price_cents: 700,
			high_price_cents: "2600",
			create_category: "create",
		}),
		{
			defaultIntensity: "high",
			intensityLocked: true,
			lowPriceCents: null,
			highPriceCents: null,
			createCategory: "create",
		},
	);
});

Deno.test("stageTermsOf reads a tiered stage's own prices, numeric strings included", () => {
	assertEquals(
		stageTermsOf({
			default_intensity: "low",
			intensity_locked: false,
			low_price_cents: "700",
			high_price_cents: 2600,
			create_category: null,
		}),
		{
			defaultIntensity: "low",
			intensityLocked: false,
			lowPriceCents: 700,
			highPriceCents: 2600,
			createCategory: null,
		},
	);
});

Deno.test("stageTermsOf reads anything the columns could not hold as their defaults", () => {
	assertEquals(stageTermsOf({}), CLIENT_STAGE_TERMS);
	assertEquals(
		stageTermsOf({
			default_intensity: "extreme",
			intensity_locked: null,
			low_price_cents: -5,
			high_price_cents: 12.5,
			create_category: "design",
		}),
		CLIENT_STAGE_TERMS,
	);
});

Deno.test("STAGE_TERM_COLUMNS names exactly the columns stageTermsOf reads", () => {
	assertEquals([...STAGE_TERM_COLUMNS], [
		"default_intensity",
		"intensity_locked",
		"low_price_cents",
		"high_price_cents",
		"create_category",
	]);
});
