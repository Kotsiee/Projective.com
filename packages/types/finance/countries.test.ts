import { assert, assertEquals } from "@std/assert";
import { COUNTRIES, countryCodeOf, countryNameOf, countryNeedsRegion } from "./countries.ts";

Deno.test("COUNTRIES holds every assigned alpha-2 code exactly once, sorted by name", () => {
	assertEquals(COUNTRIES.length, 249);
	const codes = new Set(COUNTRIES.map((c) => c.code));
	assertEquals(codes.size, COUNTRIES.length);
	for (const country of COUNTRIES) assert(/^[A-Z]{2}$/.test(country.code), country.code);
	const names = COUNTRIES.map((c) => c.name);
	const sorted = [...names].sort((a, b) => a.localeCompare(b, "en"));
	assertEquals(names, sorted);
});

Deno.test("countryCodeOf accepts a code, a name or an alias, in any case", () => {
	assertEquals(countryCodeOf("gb"), "GB");
	assertEquals(countryCodeOf(" GB "), "GB");
	assertEquals(countryCodeOf("Brazil"), "BR");
	assertEquals(countryCodeOf("united kingdom"), "GB");
	assertEquals(countryCodeOf("UK"), "GB");
	assertEquals(countryCodeOf("USA"), "US");
	assertEquals(countryCodeOf("Turkey"), "TR");
});

Deno.test("countryCodeOf never guesses", () => {
	assertEquals(countryCodeOf(""), null);
	assertEquals(countryCodeOf(null), null);
	assertEquals(countryCodeOf("Atlantis"), null);
	assertEquals(countryCodeOf("XX"), null);
});

Deno.test("countryNameOf names a code and leaves anything else alone", () => {
	assertEquals(countryNameOf("de"), "Germany");
	assertEquals(countryNameOf("Atlantis"), "Atlantis");
});

Deno.test("countryNeedsRegion follows the postal custom, not the SSOT requirement", () => {
	assert(countryNeedsRegion("US"));
	assert(countryNeedsRegion("Canada"));
	assert(!countryNeedsRegion("GB"));
	assert(!countryNeedsRegion(""));
	assert(!countryNeedsRegion("Atlantis"));
});
