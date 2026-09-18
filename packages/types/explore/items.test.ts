import { assertEquals } from "@std/assert";
import { ProductItemSchema, productMediaAspect, productSpanAspect } from "./items.ts";
import { SHOWCASE_ASPECT_MAX, SHOWCASE_ASPECT_MIN } from "../files/aspect.ts";

/**
 * The product tile's ONE ratio derivation, pinned.
 *
 * Every product surface — the masonry card, the fixed rail card, the profile's work tile — asks this
 * function for its box, so the failure mode of a drift here is one picture drawn at two shapes on two
 * pages rather than a type error. A measured cover must win over the span, and either must land inside
 * the showcase band.
 */

const base = {
	id: "pr-test",
	type: "products" as const,
	title: "Test",
	owner: { handle: "@t", name: "T", avatar: "", kind: "freelancer" as const },
	skills: [],
	summary: "",
	createdAt: "2026-09-18",
	price: "$10",
	category: "templates",
};

Deno.test("a measured cover governs the tile, not the span", () => {
	const fit = productMediaAspect({
		span: 1,
		mediaMeta: { width: 800, height: 1000, aspectRatio: 0.8 },
	});
	assertEquals(fit.ratio, 0.8);
	assertEquals(fit.fit, "natural");
});

Deno.test("an unmeasured cover falls back to the span-derived crop", () => {
	assertEquals(productMediaAspect({ span: 1, mediaMeta: undefined }).ratio, 4 / 3);
	assertEquals(productMediaAspect({ span: 2, mediaMeta: undefined }).ratio, 1);
	assertEquals(productMediaAspect({ span: 3, mediaMeta: undefined }).ratio, 4 / 5);
});

Deno.test("every span-derived ratio is already inside the showcase band", () => {
	for (const span of [1, 2, 3] as const) {
		const r = productSpanAspect(span);
		assertEquals(r >= SHOWCASE_ASPECT_MIN && r <= SHOWCASE_ASPECT_MAX, true, `span ${span}`);
	}
});

Deno.test("a measured cover outside the band is clamped and reported as a crop", () => {
	const tower = productMediaAspect({
		span: 2,
		mediaMeta: { width: 500, height: 1500, aspectRatio: 0.3333 },
	});
	assertEquals(tower.ratio, SHOWCASE_ASPECT_MIN);
	assertEquals(tower.fit, "cover");
	const strip = productMediaAspect({
		span: 2,
		mediaMeta: { width: 3000, height: 1000, aspectRatio: 3 },
	});
	assertEquals(strip.ratio, SHOWCASE_ASPECT_MAX);
	assertEquals(strip.fit, "cover");
});

Deno.test("mediaMeta is optional on the schema and refuses a non-positive dimension", () => {
	assertEquals(ProductItemSchema.safeParse({ ...base, span: 1 }).success, true);
	assertEquals(
		ProductItemSchema.safeParse({
			...base,
			span: 1,
			mediaMeta: { width: 800, height: 600, aspectRatio: 1.3333 },
		}).success,
		true,
	);
	assertEquals(
		ProductItemSchema.safeParse({
			...base,
			span: 1,
			mediaMeta: { width: 0, height: 600, aspectRatio: 0 },
		}).success,
		false,
	);
});
