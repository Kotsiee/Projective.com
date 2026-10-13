import { assertEquals } from "@std/assert";
import { SUPPORTED_LOCALES } from "@projective/types/org";
import { LOCALES } from "./locales.ts";

Deno.test("locales: Settings offers exactly the locales sign-up can seed, in the same order", () => {
	assertEquals(LOCALES.map((option) => option.value), [...SUPPORTED_LOCALES]);
});
