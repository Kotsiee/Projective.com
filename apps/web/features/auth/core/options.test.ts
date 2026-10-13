import { assertEquals } from "@std/assert";
import { EMPLOYEE_TIER_VALUES, INDUSTRY_VALUES } from "@projective/types/auth";
import { EMPLOYEE_TIERS, INDUSTRIES } from "./options.ts";

Deno.test("options: the join form offers exactly the employee tiers the join schema accepts", () => {
	assertEquals(EMPLOYEE_TIERS.map((t) => t.value), [...EMPLOYEE_TIER_VALUES]);
});

Deno.test("options: the join form offers exactly the industries the join schema accepts", () => {
	assertEquals(INDUSTRIES.map((i) => i.value), [...INDUSTRY_VALUES]);
});
