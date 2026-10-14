import { assertEquals } from "@std/assert";
import { ServiceType } from "../explore/items.ts";
import {
	DeliveryModel,
	deliveryModelOf,
	type EditSection,
	formArchetypeOf,
	hasTeamRoles,
	sectionsFor,
	serviceTypeOf,
} from "./archetype.ts";

Deno.test("formArchetypeOf maps every delivery model onto its form", () => {
	assertEquals(formArchetypeOf("product", null), "product");
	assertEquals(formArchetypeOf("product", "Pipeline"), "product");
	assertEquals(formArchetypeOf("service", "Pipeline"), "pipeline");
	assertEquals(formArchetypeOf("service", "One-Off"), "one_off");
	assertEquals(formArchetypeOf("service", "Direct Deliverable"), "one_off");
	assertEquals(formArchetypeOf("service", "Session"), "session");
	assertEquals(formArchetypeOf("service", "Group Session"), "cohort");
	assertEquals(formArchetypeOf("service", null), "one_off");
});

Deno.test("sectionsFor follows the plan §4.3 matrix", () => {
	const all: EditSection[] = [
		"media",
		"basics",
		"offer",
		"pricing",
		"availability",
		"questions",
		"seo",
	];
	const without = (...drop: EditSection[]) => all.filter((s) => !drop.includes(s));
	assertEquals(sectionsFor("product", null), without("availability", "questions"));
	assertEquals(sectionsFor("one_off", "One-Off"), without("availability"));
	assertEquals(sectionsFor("one_off", "Direct Deliverable"), without("availability"));
	assertEquals(sectionsFor("pipeline", "Pipeline"), without("availability"));
	assertEquals(sectionsFor("session", "Session"), all);
	assertEquals(sectionsFor("cohort", "Group Session"), all);
});

Deno.test("every form opens on the media showcase and ends on SEO", () => {
	for (const type of ServiceType.options) {
		const sections = sectionsFor(formArchetypeOf("service", type), type);
		assertEquals([sections[0], sections.at(-1)], ["media", "seo"]);
	}
});

Deno.test("team roles belong to Direct Deliverable and Pipeline only", () => {
	const withRoles = ServiceType.options.filter(hasTeamRoles);
	assertEquals(withRoles, ["Pipeline", "Direct Deliverable"]);
	assertEquals(hasTeamRoles(null), false);
});

Deno.test("the delivery-model slug round-trips for every model", () => {
	for (const type of ServiceType.options) assertEquals(serviceTypeOf(deliveryModelOf(type)), type);
	assertEquals(ServiceType.options.map(deliveryModelOf), DeliveryModel.options);
});
