import { assertEquals } from "@std/assert";
import {
	SWATCH_COLOR_TOKENS,
	SWATCH_NAMES,
	swatchAccent,
	SwatchAccentSchema,
	swatchOf,
} from "./swatches.ts";

Deno.test("twelve swatches, the default first, each named", () => {
	assertEquals(SWATCH_COLOR_TOKENS.length, 12);
	assertEquals(SWATCH_COLOR_TOKENS[0], "default");
	assertEquals(Object.keys(SWATCH_NAMES), [...SWATCH_COLOR_TOKENS]);
});

Deno.test("a swatch round-trips through its stored token name; the default stores none", () => {
	for (const token of SWATCH_COLOR_TOKENS) assertEquals(swatchOf(swatchAccent(token)), token);
	assertEquals(swatchAccent("default"), null);
	assertEquals(swatchAccent("teal"), "--swatch-teal");
});

Deno.test("a name that is no swatch reads as the default and is refused as a written colour", () => {
	for (
		const name of [
			null,
			undefined,
			"",
			"--primary",
			"--swatch-",
			"--swatch-default",
			"--swatch-red",
		]
	) {
		assertEquals(swatchOf(name), "default", String(name));
	}
	assertEquals(SwatchAccentSchema.safeParse("--swatch-cyan").success, true);
	for (const bad of ["--swatch-default", "--primary", "teal", "#14b8a6"]) {
		assertEquals(SwatchAccentSchema.safeParse(bad).success, false, bad);
	}
});
