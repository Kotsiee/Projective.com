import { assertEquals } from "@std/assert";
import { touchesTokenClaims } from "./preferences.ts";

Deno.test("touchesTokenClaims — the keys the access-token hook stamps", () => {
	assertEquals(touchesTokenClaims({ locale: "fr-FR" }), true);
	assertEquals(touchesTokenClaims({ preferredDisplayCurrency: "EUR" }), true);
	assertEquals(touchesTokenClaims({ preferredDisplayCurrency: null }), true);
	assertEquals(touchesTokenClaims({ dateFormat: null }), true);
	assertEquals(touchesTokenClaims({ theme: "dark", layoutDirection: "rtl" }), false);
	assertEquals(touchesTokenClaims({}), false);
});
