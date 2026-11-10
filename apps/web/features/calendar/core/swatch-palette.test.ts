import { assert, assertEquals } from "@std/assert";
import { SWATCHES } from "@ui/fields/core/swatches.ts";
import { SWATCH_COLOR_TOKENS, SWATCH_NAMES } from "@projective/types/scheduling";
import { FOLDER_COLORS } from "@features/files/core/folder-colors.ts";

/**
 * The swatch palette agrees across its three homes (Decision #408): the picker's cells
 * (`@projective/ui`), the stored vocabulary (`@projective/types`), and the token layer that paints them,
 * whose hues are the `/files` folder menu's, in its order, each with an ink that clears 4.5:1.
 */

const css = Deno.readTextFileSync(
	new URL("../../../../../packages/ui/styles/index.css", import.meta.url),
);

function token(name: string): string {
	const found = css.match(new RegExp(`\\s${name}:\\s*([^;]+);`));
	assert(found, `${name} is not declared`);
	return found[1].trim();
}

function luminance(hex: string): number {
	const n = parseInt(hex.slice(1), 16);
	const channel = (c: number) => {
		const v = c / 255;
		return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4;
	};
	return 0.2126 * channel(n >> 16) + 0.7152 * channel((n >> 8) & 255) + 0.0722 * channel(n & 255);
}

function contrast(a: string, b: string): number {
	const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
	return (hi + 0.05) / (lo + 0.05);
}

Deno.test("the picker's cells are the stored vocabulary, in order and by name", () => {
	assertEquals(SWATCHES.map((s) => s.slug), [...SWATCH_COLOR_TOKENS]);
	assertEquals(SWATCHES.map((s) => s.label), SWATCH_COLOR_TOKENS.map((t) => SWATCH_NAMES[t]));
});

Deno.test("each colour is a declared token pair whose hue is the /files folder menu's, in its order", () => {
	const colours = SWATCHES.slice(1);
	assertEquals(colours.length, FOLDER_COLORS.length);
	colours.forEach((swatch, i) => {
		assertEquals(token(`--swatch-${swatch.slug}`), FOLDER_COLORS[i].hex, swatch.slug);
		assertEquals(token(`--on-swatch-${swatch.slug}`), "var(--swatch-ink)", swatch.slug);
	});
});

Deno.test("every swatch carries its title at the 4.5:1 text floor", () => {
	const ink = token("--swatch-ink");
	for (const swatch of SWATCHES.slice(1)) {
		const ratio = contrast(token(`--swatch-${swatch.slug}`), ink);
		assert(ratio >= 4.5, `${swatch.slug} is ${ratio.toFixed(2)}:1`);
	}
});
