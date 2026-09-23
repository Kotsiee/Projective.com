import { assertEquals } from "@std/assert";
import { displayPrice } from "./live-catalog.ts";

/**
 * `displayPrice` turns stored minor units into the legacy card string. It must read the currency's own
 * exponent: every seeded listing is USD today, so a fixed `/ 100` would pass every live check and still
 * print a ¥5,000 listing as ¥50 the day one exists.
 */

Deno.test("displayPrice — a two-decimal currency keeps its cents, and drops them when whole", () => {
	assertEquals(displayPrice(12345, "USD"), "$123.45");
	assertEquals(displayPrice(320000, "USD"), "$3,200");
	assertEquals(displayPrice(12000, "GBP"), "£120");
});

Deno.test("displayPrice — a zero-decimal currency is not divided by a hundred", () => {
	assertEquals(displayPrice(5000, "JPY"), "¥5,000");
});

Deno.test("displayPrice — a three-decimal currency keeps all three places", () => {
	// Intl separates a currency CODE from its figure with a no-break space.
	assertEquals(displayPrice(1500, "KWD").replace(/\s/g, " "), "KWD 1.500");
});
