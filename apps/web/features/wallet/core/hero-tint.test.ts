import { assert, assertEquals } from "@std/assert";
import {
	AURORA_CONTRAST_TARGET,
	compositeOver,
	contrastRatio,
	relativeLuminance,
	type Rgb,
} from "./aurora-engine.ts";
import { dominantColor, heroPaletteFrom, TINT_CEILING } from "./hero-tint.ts";

const SOURCES: Record<string, Rgb> = {
	black: [0, 0, 0],
	white: [1, 1, 1],
	grey: [0.5, 0.5, 0.5],
	neonYellow: [1, 1, 0],
	neonCyan: [0, 1, 1],
	nearBlackNavy: [0.02, 0.02, 0.08],
	brandRed: [0.86, 0.15, 0.2],
};

function rgbOf(hex: string): Rgb {
	assert(/^#[0-9a-f]{6}$/.test(hex), `not #rrggbb: ${hex}`);
	return [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255) as unknown as Rgb;
}

Deno.test("heroPaletteFrom: every stop, under every ink, clears 4.5:1 whatever the source", () => {
	for (const [name, source] of Object.entries(SOURCES)) {
		for (const [role, hex] of Object.entries(heroPaletteFrom(source))) {
			const ground = rgbOf(hex);
			const lum = relativeLuminance(ground);
			assert(lum <= TINT_CEILING + 1e-3, `${name}.${role} ${hex} is over the ceiling`);
			const solid = contrastRatio(1, lum);
			const soft = contrastRatio(relativeLuminance(compositeOver([1, 1, 1, 0.84], ground)), lum);
			const glass = contrastRatio(1, relativeLuminance(compositeOver([1, 1, 1, 0.12], ground)));
			for (const ratio of [solid, soft, glass]) {
				assert(
					ratio >= AURORA_CONTRAST_TARGET,
					`${name}.${role} ${hex} gives ${ratio.toFixed(2)}:1`,
				);
			}
		}
	}
});

Deno.test("heroPaletteFrom: a chromatic source keeps its hue; a neutral one gets the slate", () => {
	const [r, g, b] = rgbOf(heroPaletteFrom(SOURCES.brandRed).cyan);
	assert(r > g && r > b, "a red picture tints the hero red");
	assertEquals(heroPaletteFrom(SOURCES.white), heroPaletteFrom(SOURCES.black));
	assertEquals(heroPaletteFrom(SOURCES.grey), heroPaletteFrom(SOURCES.black));
});

Deno.test("dominantColor: the colourful mark outweighs a larger plain ground; transparency is skipped", () => {
	const px = (r: number, g: number, b: number, a = 255) => [r, g, b, a];
	const pixels = new Uint8ClampedArray([
		...Array.from({ length: 5 }, () => px(250, 250, 250)).flat(),
		...Array.from({ length: 3 }, () => px(220, 30, 40)).flat(),
		...Array.from({ length: 20 }, () => px(0, 255, 0, 0)).flat(),
	]);
	const [r, g, b] = dominantColor(pixels)!;
	assert(r > 0.8 && g < 0.2 && b < 0.2);
	assertEquals(dominantColor(new Uint8ClampedArray([0, 0, 0, 0])), null);
});
