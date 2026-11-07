/**
 * pptx-color — DrawingML colour arithmetic: a theme colour plus the transforms a deck stacks on it
 * (`lumMod`, `lumOff`, `tint`, `shade`, `alpha`…). Pure, because it is the part of drawing a slide
 * that is easiest to get subtly wrong and impossible to see in a code review.
 */

/** One transform as the file writes it: `val` is in 1000ths of a percent, so `50000` is 50%. */
export interface ColorTransform {
	name: string;
	value: number;
}

interface Hsl {
	h: number;
	s: number;
	l: number;
}

function channels(hex: string): [number, number, number] {
	const value = parseInt(hex.replace(/^#/, "").padEnd(6, "0").slice(0, 6), 16);
	return [(value >> 16) & 255, (value >> 8) & 255, value & 255];
}

function toHsl([r8, g8, b8]: [number, number, number]): Hsl {
	const [r, g, b] = [r8 / 255, g8 / 255, b8 / 255];
	const max = Math.max(r, g, b);
	const min = Math.min(r, g, b);
	const l = (max + min) / 2;
	const d = max - min;
	if (d === 0) return { h: 0, s: 0, l };
	const s = d / (1 - Math.abs(2 * l - 1));
	const h = max === r ? ((g - b) / d + 6) % 6 : max === g ? (b - r) / d + 2 : (r - g) / d + 4;
	return { h: h * 60, s, l };
}

function fromHsl({ h, s, l }: Hsl): [number, number, number] {
	const c = (1 - Math.abs(2 * l - 1)) * s;
	const x = c * (1 - Math.abs((h / 60) % 2 - 1));
	const m = l - c / 2;
	const sector = Math.floor(h / 60) % 6;
	const [r, g, b] = [[c, x, 0], [x, c, 0], [0, c, x], [0, x, c], [x, 0, c], [c, 0, x]][sector];
	return [r, g, b].map((v) => Math.round((v + m) * 255)) as [number, number, number];
}

function clamp01(value: number): number {
	return Math.max(0, Math.min(1, value));
}

/**
 * Apply a colour's transforms, in file order, and answer a CSS colour: `#rrggbb` when opaque, an
 * `rgba()` when not.
 */
export function transformColor(hex: string, transforms: readonly ColorTransform[]): string {
	let rgb = channels(hex);
	let alpha = 1;
	for (const { name, value } of transforms) {
		const amount = value / 100_000;
		switch (name) {
			case "lumMod": {
				const hsl = toHsl(rgb);
				rgb = fromHsl({ ...hsl, l: clamp01(hsl.l * amount) });
				break;
			}
			case "lumOff": {
				const hsl = toHsl(rgb);
				rgb = fromHsl({ ...hsl, l: clamp01(hsl.l + amount) });
				break;
			}
			case "satMod": {
				const hsl = toHsl(rgb);
				rgb = fromHsl({ ...hsl, s: clamp01(hsl.s * amount) });
				break;
			}
			case "tint":
				rgb = rgb.map((c) => Math.round(255 - (255 - c) * amount)) as typeof rgb;
				break;
			case "shade":
				rgb = rgb.map((c) => Math.round(c * amount)) as typeof rgb;
				break;
			case "alpha":
				alpha = clamp01(amount);
				break;
		}
	}
	if (alpha >= 1) return `#${rgb.map((c) => c.toString(16).padStart(2, "0")).join("")}`;
	return `rgba(${rgb.join(", ")}, ${Math.round(alpha * 1000) / 1000})`;
}
