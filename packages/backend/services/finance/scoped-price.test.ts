import { assertEquals } from "@std/assert";
import { scopedPriceCents } from "./live-basket.ts";

const stage = (name: string, priceCents?: number, intensity = "standard") => ({
	name,
	description: "",
	deliverables: [],
	skills: [],
	intensity,
	...(priceCents === undefined ? {} : { priceCents }),
});

const oneOff = (stages: unknown[]) => ({
	delivery_model: "one_off" as const,
	price_cents: 610_000,
	stage_template: stages,
});

Deno.test("a One-Off charges milestone 1, or every milestone under the whole-project prepay", () => {
	const bp = oneOff([stage("Discovery", 120_000), stage("Build", 80_000), stage("Launch", 80_000)]);
	assertEquals(scopedPriceCents(bp, false), 120_000);
	assertEquals(scopedPriceCents(bp, true), 280_000);
});

Deno.test("the milestones' own prices are charged, never the listing's headline price", () => {
	const bp = oneOff([stage("A", 203_000), stage("B", 203_000), stage("C", 203_000)]);
	assertEquals(scopedPriceCents(bp, true), 609_000);
});

Deno.test("a One-Off milestone sells at its stated price whatever its intensity", () => {
	assertEquals(scopedPriceCents(oneOff([stage("A", 100_000, "high")]), false), 100_000);
});

Deno.test("an unpriced or free charged milestone leaves the line unpriced, an uncharged one does not", () => {
	const bp = oneOff([stage("A", 120_000), stage("B")]);
	assertEquals(scopedPriceCents(bp, false), 120_000);
	assertEquals(scopedPriceCents(bp, true), null);
	assertEquals(scopedPriceCents(oneOff([stage("A", 0)]), false), null);
	assertEquals(scopedPriceCents(oneOff([]), false), null);
});

Deno.test("a Task is the listing's price; any other delivery model is not scoped", () => {
	assertEquals(
		scopedPriceCents({
			delivery_model: "direct_deliverable",
			price_cents: 190_000,
			stage_template: [],
		}, false),
		190_000,
	);
	assertEquals(
		scopedPriceCents(
			{ delivery_model: "direct_deliverable", price_cents: 0, stage_template: [] },
			true,
		),
		null,
	);
	assertEquals(
		scopedPriceCents({ delivery_model: "pipeline", price_cents: 9_000, stage_template: [] }, true),
		null,
	);
});
