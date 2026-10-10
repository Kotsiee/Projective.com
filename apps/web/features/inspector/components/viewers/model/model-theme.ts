/// <reference lib="dom" />

/**
 * model-theme — the canvas's colours, read from the design tokens at runtime. The stage renders a
 * few hidden swatch elements whose CSS sets `color` from tokens; this module resolves each one's
 * computed colour to sRGB numbers through a 1×1 2D canvas, so any colour syntax the tokens use
 * (hex, `color-mix()`, `oklch()`) reaches WebGL without a literal in source.
 */

// #region Types
/** sRGB channels and alpha, each 0..1. */
export type Rgba = readonly [number, number, number, number];

/** The token-driven colours the canvas paints with. */
export interface ModelPalette {
	/** The stage surface, used for the "theme" background. */
	theme: Rgba;
	/** Body text on the stage surface, mixed into the grid. */
	ink: Rgba;
	dark: Rgba;
	light: Rgba;
	accent: Rgba;
}

/** The swatch names the stage renders, one `data-swatch` element each. */
export const SWATCHES: readonly (keyof ModelPalette)[] = [
	"theme",
	"ink",
	"dark",
	"light",
	"accent",
];
// #endregion

// #region Resolution
/** Neutral stand-ins for helper colours while the swatch styles have not arrived. */
export const FALLBACK_PALETTE: ModelPalette = {
	theme: [0.5, 0.5, 0.5, 1],
	ink: [0.1, 0.1, 0.1, 1],
	dark: [0.1, 0.1, 0.1, 1],
	light: [0.94, 0.94, 0.94, 1],
	accent: [0.3, 0.4, 0.9, 1],
};

let probe: CanvasRenderingContext2D | null = null;

function probeContext(): CanvasRenderingContext2D | null {
	if (probe) return probe;
	const canvas = document.createElement("canvas");
	canvas.width = 1;
	canvas.height = 1;
	probe = canvas.getContext("2d", { willReadFrequently: true });
	return probe;
}

function resolveColor(css: string, ctx: CanvasRenderingContext2D): Rgba | null {
	if (css.trim().length === 0) return null;
	ctx.clearRect(0, 0, 1, 1);
	ctx.fillStyle = "transparent";
	ctx.fillStyle = css;
	ctx.fillRect(0, 0, 1, 1);
	const [r, g, b, a] = ctx.getImageData(0, 0, 1, 1).data;
	if (a === 0) return null;
	return [r / 255, g / 255, b / 255, a / 255];
}

/**
 * Read every swatch under `host`. Returns `null` while the swatch styles are not applied yet (in
 * development the stylesheet can land after hydration): every swatch then just inherits its
 * container's colour, so the theme, dark and light swatches all read the same.
 */
export function readPalette(host: HTMLElement): ModelPalette | null {
	const ctx = probeContext();
	if (!ctx) return null;
	const computed = new Map<keyof ModelPalette, string>();
	for (const name of SWATCHES) {
		const el = host.querySelector<HTMLElement>(`[data-swatch="${name}"]`);
		if (el) computed.set(name, getComputedStyle(el).color);
	}
	const theme = computed.get("theme");
	if (!theme || (theme === computed.get("dark") && theme === computed.get("light"))) return null;
	const palette: Record<keyof ModelPalette, Rgba> = { ...FALLBACK_PALETTE };
	for (const [name, css] of computed) {
		const resolved = resolveColor(css, ctx);
		if (resolved) palette[name] = resolved;
	}
	return palette;
}

/** Blend two colours in sRGB: `t = 0` is `a`, `t = 1` is `b`. */
export function mixRgba(a: Rgba, b: Rgba, t: number): Rgba {
	const c = Math.max(0, Math.min(1, t));
	return [
		a[0] + (b[0] - a[0]) * c,
		a[1] + (b[1] - a[1]) * c,
		a[2] + (b[2] - a[2]) * c,
		a[3] + (b[3] - a[3]) * c,
	];
}
// #endregion
