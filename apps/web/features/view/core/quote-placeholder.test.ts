import { assertEquals } from "@std/assert";
import { BUDGET_PLACEHOLDER, quotePlaceholder } from "./quote-placeholder.ts";

const price = (minor: number, currency: string, isFloor = false) => ({
	amount: { minor, currency },
	fallback: "",
	isFloor,
});

Deno.test("quotePlaceholder states the listing's price as a bare figure in the field's currency", () => {
	assertEquals(quotePlaceholder(price(125000, "GBP"), "GBP", "en-GB"), "1,250.00");
	assertEquals(quotePlaceholder(price(45000, "GBP", true), "GBP", "en-GB"), "From 450.00");
	assertEquals(quotePlaceholder(price(5000, "JPY"), "JPY", "en-GB"), "5,000");
});

Deno.test("quotePlaceholder falls back when there is no figure in that currency", () => {
	assertEquals(
		quotePlaceholder({ amount: null, fallback: "On request", isFloor: false }, "GBP"),
		BUDGET_PLACEHOLDER,
	);
	assertEquals(quotePlaceholder(price(125000, "EUR"), "GBP", "en-GB"), BUDGET_PLACEHOLDER);
});
