import { assertEquals } from "@std/assert";
import { ScopedTargetDateSchema } from "@projective/types/services";
import { earliestTargetDate, targetDateOf } from "./target-date.ts";

Deno.test("targetDateOf: the picker's local day as YYYY-MM-DD, null for none", () => {
	assertEquals(targetDateOf(new Date(2026, 11, 3, 23, 30)), "2026-12-03");
	assertEquals(targetDateOf([new Date(2027, 0, 9)]), "2027-01-09");
	assertEquals(targetDateOf(null), null);
	assertEquals(targetDateOf([]), null);
	assertEquals(targetDateOf(new Date(Number.NaN)), null);
});

Deno.test("earliestTargetDate: tomorrow, across a month and a year end", () => {
	assertEquals(targetDateOf(earliestTargetDate(new Date(2026, 10, 18, 9))), "2026-11-19");
	assertEquals(targetDateOf(earliestTargetDate(new Date(2026, 11, 31, 22))), "2027-01-01");
});

Deno.test("what targetDateOf produces is what the configure payload accepts", () => {
	const iso = targetDateOf(new Date(2028, 1, 29));
	assertEquals(iso, "2028-02-29");
	assertEquals(ScopedTargetDateSchema.safeParse(iso).success, true);
	assertEquals(ScopedTargetDateSchema.safeParse("2027-02-29").success, false);
	assertEquals(ScopedTargetDateSchema.safeParse("29/02/2028").success, false);
});
