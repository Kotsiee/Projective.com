/// <reference lib="dom" />
import {
	AURORA_PALETTE_TOKENS,
	auroraCeiling,
	clampLuminance,
	linearToSrgb,
	type Rgb,
	srgbToLinear,
} from "./aurora-engine.ts";

/** The hero's five aurora colours, keyed as {@link AURORA_PALETTE_TOKENS}, as `#rrggbb`. */
export type HeroPalette = Record<keyof typeof AURORA_PALETTE_TOKENS, string>;

/**
 * The brightest a tinted stop may be: solved for the hero's inks — `--on-scrim` (white) solid, its 84%
 * soft twin, and white on the 12% glass fill (wallet-tokens.css) — at 4.5:1 plus the aurora's margin.
 */
export const TINT_CEILING = auroraCeiling([1, 1, 1, 1], [1, 1, 1, 0.84], [1, 1, 1, 0.12]);

/** Below this chroma (max − min channel) a source has no hue worth keeping: black, white, greys. */
const NEUTRAL_CHROMA = 0.08;
/** The slate the hero falls back to for a neutral source. */
const NEUTRAL = { h: 220, s: 0.12 };

/**
 * Each stop's hue offset, saturation factor and lightness: one hue with a narrow analogous spread
 * either side, so a warm source does not walk into the yellows the ceiling would darken to olive.
 */
const STOPS: Readonly<Record<keyof HeroPalette, readonly [number, number, number]>> = {
	cyan: [0, 1, 0.55],
	cobalt: [-22, 0.95, 0.45],
	violet: [28, 0.85, 0.4],
	deep: [0, 0.7, 0.14],
	base: [0, 0.6, 0.06],
};

function hsl(h: number, s: number, l: number): Rgb {
	const a = s * Math.min(l, 1 - l);
	const f = (n: number) => {
		const k = (n + h / 30) % 12;
		return l - a * Math.max(-1, Math.min(k - 3, 9 - k, 1));
	};
	return [f(0), f(8), f(4)];
}

function hueOf([r, g, b]: Rgb): { h: number; s: number } {
	const max = Math.max(r, g, b);
	const min = Math.min(r, g, b);
	const d = max - min;
	if (d < NEUTRAL_CHROMA) return NEUTRAL;
	const h = max === r ? ((g - b) / d + 6) % 6 : max === g ? (b - r) / d + 2 : (r - g) / d + 4;
	const s = d / (1 - Math.abs(max + min - 1));
	return { h: h * 60, s: Math.min(0.9, Math.max(0.45, s)) };
}

// Floored, so quantising to 8 bits can never lift a stop over the ceiling it was clamped to.
function hex(rgb: Rgb): string {
	return `#${rgb.map((c) => Math.floor(c * 255).toString(16).padStart(2, "0")).join("")}`;
}

/**
 * A hero palette from one source colour (gamma-encoded sRGB, 0–1). Only the source's hue — and its
 * saturation, held between bounds — survives: every stop's lightness is the palette's own, then each
 * stop is scaled in linear light to {@link TINT_CEILING}, keeping its chromaticity. So a black, white,
 * grey, neon or near-black picture all give a ground the hero's white ink clears 4.5:1 on; a source
 * with no hue gets a quiet slate.
 */
export function heroPaletteFrom(source: Rgb): HeroPalette {
	const { h, s } = hueOf(source);
	const entries = Object.entries(STOPS).map(([role, [shift, sat, light]]) => {
		const linear = hsl((h + shift + 360) % 360, s * sat, light).map(srgbToLinear) as unknown as Rgb;
		const safe = clampLuminance(linear, TINT_CEILING).map(linearToSrgb) as unknown as Rgb;
		return [role, hex(safe)];
	});
	return Object.fromEntries(entries) as HeroPalette;
}

/**
 * The dominant colour of a picture's RGBA pixels: pixels binned four bits a channel, each weighted by
 * its chroma so a logo's colour outweighs the plain ground around it, and the heaviest bin's mean
 * returned. Transparent pixels are skipped; `null` when nothing is left.
 */
export function dominantColor(pixels: Uint8ClampedArray): Rgb | null {
	const bins = new Map<number, { w: number; r: number; g: number; b: number }>();
	for (let i = 0; i + 3 < pixels.length; i += 4) {
		if (pixels[i + 3] < 128) continue;
		const [r, g, b] = [pixels[i], pixels[i + 1], pixels[i + 2]];
		const w = 0.1 + (Math.max(r, g, b) - Math.min(r, g, b)) / 255;
		const key = ((r >> 4) << 8) | ((g >> 4) << 4) | (b >> 4);
		const bin = bins.get(key) ?? { w: 0, r: 0, g: 0, b: 0 };
		bin.w += w;
		bin.r += r * w;
		bin.g += g * w;
		bin.b += b * w;
		bins.set(key, bin);
	}
	let best: { w: number; r: number; g: number; b: number } | null = null;
	for (const bin of bins.values()) if (!best || bin.w > best.w) best = bin;
	if (!best) return null;
	return [best.r / best.w / 255, best.g / best.w / 255, best.b / best.w / 255];
}

/** How many pixels a side the picture is read at: enough for a dominant colour, cheap to scan. */
const SAMPLE_EDGE = 24;

/**
 * Reads a picture's pixels, downscaled. `null` when it cannot be read — a failed load, or a host that
 * sends no CORS headers, whose picture taints the canvas and refuses `getImageData`.
 */
export function samplePicture(src: string): Promise<Uint8ClampedArray | null> {
	return new Promise((resolve) => {
		const img = new Image();
		img.crossOrigin = "anonymous";
		img.decoding = "async";
		img.onerror = () => resolve(null);
		img.onload = () => {
			try {
				const canvas = document.createElement("canvas");
				canvas.width = SAMPLE_EDGE;
				canvas.height = SAMPLE_EDGE;
				const ctx = canvas.getContext("2d", { willReadFrequently: true });
				if (!ctx) return resolve(null);
				ctx.drawImage(img, 0, 0, SAMPLE_EDGE, SAMPLE_EDGE);
				resolve(ctx.getImageData(0, 0, SAMPLE_EDGE, SAMPLE_EDGE).data);
			} catch {
				resolve(null);
			}
		};
		img.src = src;
	});
}

/**
 * Tints the hero from a team's or a business's picture: writes the derived palette onto the hero's
 * `--wlt-aurora-*` tokens, which its gradient and its live canvas both read. A picture that cannot be
 * read leaves the default aurora. Resolves once applied (or not); `isLive` lets a caller that has
 * since unmounted drop the result.
 */
export async function tintHero(
	host: HTMLElement,
	picture: string,
	isLive: () => boolean,
): Promise<void> {
	const pixels = await samplePicture(picture);
	const source = pixels ? dominantColor(pixels) : null;
	if (!source || !isLive()) return;
	const palette = heroPaletteFrom(source);
	for (const role of Object.keys(palette) as (keyof HeroPalette)[]) {
		host.style.setProperty(AURORA_PALETTE_TOKENS[role], palette[role]);
	}
}
