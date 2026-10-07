import { assert } from "@std/assert";

/**
 * Pins the checkout commit colour (Decision #153) against the stylesheet itself, so the measured
 * ratio cannot drift from the declared one: ≥ 7:1 at rest (the pair is mode-invariant, so one
 * measurement covers light and dark), and NEVER lower on hover or press than at rest (§3 gate 12).
 * The hover/press fills are computed exactly as the Button draws them — `color-mix(in srgb, accent
 * N%, shade)` with the mix amounts `.ui-button.cko-commit` declares.
 */

const css = await Deno.readTextFile(new URL("../styles/checkout-shared.css", import.meta.url));

type Rgb = [number, number, number];

function token(name: string): string {
	const match = css.match(new RegExp(`--${name}:\\s*([^;]+);`));
	if (!match) throw new Error(`--${name} is not declared`);
	return match[1].trim();
}

function parse(value: string): Rgb {
	const hex = value.match(/^#([0-9a-f]{6})$/i);
	if (hex) {
		const n = parseInt(hex[1], 16);
		return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
	}
	const hsl = value.match(/^hsl\(\s*([\d.]+)\s+([\d.]+)%\s+([\d.]+)%\s*\)$/);
	if (!hsl) throw new Error(`unparsed colour ${value}`);
	const [h, s, l] = [Number(hsl[1]), Number(hsl[2]) / 100, Number(hsl[3]) / 100];
	const c = (1 - Math.abs(2 * l - 1)) * s;
	const x = c * (1 - Math.abs(((h / 60) % 2) - 1));
	const m = l - c / 2;
	const [r, g, b] = h < 60
		? [c, x, 0]
		: h < 120
		? [x, c, 0]
		: h < 180
		? [0, c, x]
		: h < 240
		? [0, x, c]
		: h < 300
		? [x, 0, c]
		: [c, 0, x];
	return [r, g, b].map((v) => Math.round((v + m) * 255)) as Rgb;
}

function luminance([r, g, b]: Rgb): number {
	const lin = (v: number) => {
		const s = v / 255;
		return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
	};
	return 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b);
}

function contrast(a: Rgb, b: Rgb): number {
	const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
	return (hi + 0.05) / (lo + 0.05);
}

function mix(a: Rgb, share: number, b: Rgb): Rgb {
	return a.map((v, i) => Math.round(v * share + b[i] * (1 - share))) as Rgb;
}

function mixAmount(name: string): number {
	const match = css.match(new RegExp(`--${name}:\\s*([\\d.]+)%`));
	if (!match) throw new Error(`--${name} is not declared`);
	return Number(match[1]) / 100;
}

const bg = parse(token("checkout-commit-bg"));
const fg = parse(token("checkout-commit-fg"));
const pole = parse(token("checkout-commit-pole"));

Deno.test("the commit ink clears 7:1 on the commit fill", () => {
	const ratio = contrast(bg, fg);
	assert(ratio >= 7, `rest ${ratio.toFixed(2)}:1`);
});

Deno.test("hover and press never lower the commit label's contrast", () => {
	const rest = contrast(bg, fg);
	const hover = contrast(mix(bg, mixAmount("btn-mix-hover"), pole), fg);
	const press = contrast(mix(bg, mixAmount("btn-mix-active"), pole), fg);
	assert(hover >= rest, `hover ${hover.toFixed(2)} < rest ${rest.toFixed(2)}`);
	assert(press >= hover, `press ${press.toFixed(2)} < hover ${hover.toFixed(2)}`);
});
