import { assertEquals } from "@std/assert";
import { PAID_CALLS_LIVE } from "@projective/types/scheduling";
import { schedulerPricing } from "./availability-pricing.ts";

const FEE = { amountMinor: 6000, currency: "EUR" };

Deno.test("schedulerPricing — no field while paid calls are off, which is the shipped default", () => {
	assertEquals(PAID_CALLS_LIVE, false);
	assertEquals(schedulerPricing({ callFee: FEE }), undefined);
	assertEquals(schedulerPricing({ callFee: FEE }, false), undefined);
});

Deno.test("schedulerPricing — once live, a rule is priced in the call fee's currency and inherits it", () => {
	assertEquals(schedulerPricing({ callFee: FEE }, true), { currency: "EUR", inherited: FEE });
});

Deno.test("schedulerPricing — with no call fee set, the platform base currency and nothing to inherit", () => {
	assertEquals(schedulerPricing({ callFee: null }, true), { currency: "GBP", inherited: null });
	assertEquals(schedulerPricing(null, true), { currency: "GBP", inherited: null });
});
