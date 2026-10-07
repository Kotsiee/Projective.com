import { assert, assertEquals } from "@std/assert";
import {
	EnableFreelancerInputSchema,
	FreelancerConversionResultSchema,
	MAX_STARTER_SKILLS,
} from "./freelancer-conversion.ts";

const slugs = (n: number) => Array.from({ length: n }, (_, i) => `skill-${i + 1}`);

Deno.test("EnableFreelancerInput — one to ten known-shape slugs are accepted", () => {
	assert(EnableFreelancerInputSchema.safeParse({ skills: ["figma"] }).success);
	assert(EnableFreelancerInputSchema.safeParse({ skills: slugs(MAX_STARTER_SKILLS) }).success);
});

Deno.test("EnableFreelancerInput — an empty list and an eleventh skill are refused", () => {
	assertEquals(EnableFreelancerInputSchema.safeParse({ skills: [] }).success, false);
	assertEquals(
		EnableFreelancerInputSchema.safeParse({ skills: slugs(MAX_STARTER_SKILLS + 1) }).success,
		false,
	);
	assertEquals(EnableFreelancerInputSchema.safeParse({}).success, false);
});

Deno.test("EnableFreelancerInput — free text is not a slug", () => {
	for (const bad of ["Motion Design", "ux_research", "-figma", "figma-", "a--b", ""]) {
		assertEquals(EnableFreelancerInputSchema.safeParse({ skills: [bad] }).success, false, bad);
	}
});

Deno.test("EnableFreelancerInput — slugs are normalised and de-duplicated in order", () => {
	const parsed = EnableFreelancerInputSchema.parse({ skills: [" Figma ", "ux", "figma"] });
	assertEquals(parsed.skills, ["figma", "ux"]);
});

Deno.test("FreelancerConversionResult — the RPC's answer, camel-cased", () => {
	const ok = FreelancerConversionResultSchema.safeParse({
		freelancerProfileId: "2bdebf14-f7dc-40af-acd8-fe22cb9916fd",
		handle: "theo",
		created: true,
		isFreelancer: true,
	});
	assert(ok.success);
	const notFreelancer = FreelancerConversionResultSchema.safeParse({
		freelancerProfileId: "2bdebf14-f7dc-40af-acd8-fe22cb9916fd",
		handle: "theo",
		created: true,
		isFreelancer: false,
	});
	assertEquals(notFreelancer.success, false);
});
