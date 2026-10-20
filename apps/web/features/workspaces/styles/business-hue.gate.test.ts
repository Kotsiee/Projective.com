/**
 * business-hue.gate — the business kind hue (Decision #230 (j), Businesses work order BU1), held as a
 * test because the type-checker cannot see a stylesheet.
 *
 * `--wsp-business` is `--tertiary` in EVERY mode and overlay, with its `-on` / `-tint` / `-tint-hi` /
 * `-edge` / `-ink` derived from it. It is not `--secondary`, because `--secondary` is the focus ring's
 * ink (`theme-engine.ts`, `ringInk`): a business mark painted in it measured ΔE_OK 0.00 against the
 * ring. So this gate holds, structurally:
 *
 *   - `:root` anchors the hue on `--tertiary` and its filled pair on `--on-tertiary`;
 *   - no `--wsp-business*` declaration in any workspace sheet reads `--secondary` or `transparent`
 *     (W1: every mix is opaque);
 *   - high contrast widens the tint, the tint-hi, the edge AND the ink;
 *   - no colour-vision overlay re-anchors the business side (it is already `--tertiary` everywhere).
 *
 * And, measurably: the percentages are PARSED from the sheet and re-computed over the theme engine's
 * own scheme (`buildScheme`, the `projects/core/status-fill.test.ts` precedent) in all four
 * mode/contrast states. For three seeds each pair is held to its FLOOR: normal contrast owes 4.5:1
 * for the mark's ink on its tints and for `--on-tertiary` on the solid hue; high contrast owes 7:1 for
 * each, a 3:1 edge against the card, and a wider tint-hi step than normal; the ring's ink and the hue
 * must not be one colour (a non-identity floor — they still share a tone, flag (a)). For the brand
 * seed every figure the docs PUBLISH (DESIGN_SYSTEM §A.1.3's table — ink on tint-hi, on tint and on
 * `--surface-1`, `--on-tertiary` on the hue, the edge — plus the high-contrast tint-hi step and the
 * ring residual) is pinned to its two printed decimals, so a drift fails here rather than leaving
 * the docs stale.
 */
import { assert, assertEquals } from "@std/assert";
import { buildScheme } from "@projective/ui/system";

// #region Sources
const STYLES_DIR = new URL("./", import.meta.url);

/** A sheet's text with every comment removed and line endings normalised. */
function readSheet(name: string): string {
	return Deno.readTextFileSync(new URL(name, STYLES_DIR))
		.replace(/\r\n?/g, "\n")
		.replace(/\/\*[\s\S]*?\*\//g, "");
}

const SHEET_NAMES = [...Deno.readDirSync(STYLES_DIR)]
	.filter((entry) => entry.isFile && entry.name.endsWith(".css"))
	.map((entry) => entry.name)
	.sort();
const SHEETS = SHEET_NAMES.map((name) => ({ name, css: readSheet(name) }));
const TOKENS = readSheet("workspace-tokens.css");

/** One innermost rule: its selector list (whitespace collapsed) and its declaration block. */
interface Rule {
	selector: string;
	body: string;
}

/** Every innermost rule of a comment-free sheet (a rule inside an at-rule is listed on its own). */
function rules(css: string): Rule[] {
	return [...css.matchAll(/([^{}]+)\{([^{}]*)\}/g)].map((m) => ({
		selector: m[1].replace(/\s+/g, " ").trim(),
		body: m[2],
	}));
}

/** The declarations of the rule whose selector is EXACTLY `selector`. */
function block(css: string, selector: string): string {
	const found = rules(css).filter((rule) => rule.selector === selector);
	assertEquals(found.length, 1, `expected one \`${selector}\` rule, found ${found.length}`);
	return found[0].body;
}

/** A custom property's value in a declaration block, or `null`. */
function valueOf(body: string, property: string): string | null {
	const m = new RegExp(`(?:^|[;\\s])${property}\\s*:\\s*([^;]+);`).exec(body);
	return m ? m[1].replace(/\s+/g, " ").trim() : null;
}

/** One `color-mix(in <space>, var(--wsp-business) <p>%, var(--<base>))` formula. */
interface Mix {
	space: "srgb" | "oklab";
	share: number;
	base: string;
}

/** Parse a business token's mix; fails the gate when it is any other shape. */
function mixOf(body: string, property: string): Mix {
	const value = valueOf(body, property);
	assert(value, `${property} is not declared`);
	const m =
		/^color-mix\(in (srgb|oklab), var\(--wsp-business\) (\d+(?:\.\d+)?)%, var\(--([\w-]+)\)\)$/
			.exec(value);
	assert(m, `${property}: \`${value}\` is not a mix of --wsp-business against one solid token`);
	return { space: m[1] as Mix["space"], share: Number(m[2]) / 100, base: m[3] };
}

const ROOT = block(TOKENS, ":root");
const HIGH = block(TOKENS, ':root[data-contrast="high"]');
// #endregion

// #region Colour math
type Rgb = [number, number, number];

function rgb(hex: string): Rgb {
	const n = parseInt(hex.slice(1, 7), 16);
	return [(n >> 16) & 255, (n >> 8) & 255, n & 255].map((v) => v / 255) as Rgb;
}

const toLinear = (v: number) => (v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4);
const toGamma = (v: number) => (v <= 0.0031308 ? v * 12.92 : 1.055 * v ** (1 / 2.4) - 0.055);

function luminance(c: Rgb): number {
	const [r, g, b] = c.map(toLinear);
	return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

function contrast(a: Rgb, b: Rgb): number {
	const [hi, lo] = [luminance(a), luminance(b)].sort((p, q) => q - p);
	return (hi + 0.05) / (lo + 0.05);
}

function oklab(c: Rgb): Rgb {
	const [r, g, b] = c.map(toLinear);
	const l = Math.cbrt(0.4122214708 * r + 0.5363325363 * g + 0.0514459929 * b);
	const m = Math.cbrt(0.2119034982 * r + 0.6806995451 * g + 0.1073969566 * b);
	const s = Math.cbrt(0.0883024619 * r + 0.2817188376 * g + 0.6299787005 * b);
	return [
		0.2104542553 * l + 0.793617785 * m - 0.0040720468 * s,
		1.9779984951 * l - 2.428592205 * m + 0.4505937099 * s,
		0.0259040371 * l + 0.7827717662 * m - 0.808675766 * s,
	];
}

function fromOklab([L, A, B]: Rgb): Rgb {
	const l = (L + 0.3963377774 * A + 0.2158037573 * B) ** 3;
	const m = (L - 0.1055613458 * A - 0.0638541728 * B) ** 3;
	const s = (L - 0.0894841775 * A - 1.291485548 * B) ** 3;
	return [
		4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s,
		-1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s,
		-0.0041960863 * l - 0.7034186147 * m + 1.707614701 * s,
	].map((v) => toGamma(Math.min(1, Math.max(0, v)))) as Rgb;
}

/** `color-mix(in <space>, a <share>, b)` as the browser computes it. */
function mix(a: Rgb, { space, share }: Pick<Mix, "space" | "share">, b: Rgb): Rgb {
	if (space === "srgb") return a.map((v, i) => v * share + b[i] * (1 - share)) as Rgb;
	const [x, y] = [oklab(a), oklab(b)];
	return fromOklab(x.map((v, i) => v * share + y[i] * (1 - share)) as Rgb);
}

/** The OKLab distance between two colours — how far apart two marks read, independent of luminance. */
function deltaE(a: Rgb, b: Rgb): number {
	const [x, y] = [oklab(a), oklab(b)];
	return Math.hypot(x[0] - y[0], x[1] - y[1], x[2] - y[2]);
}
// #endregion

// #region Structure
Deno.test("business hue: :root anchors --wsp-business on --tertiary and its filled pair on --on-tertiary", () => {
	assertEquals(valueOf(ROOT, "--wsp-business"), "var(--tertiary)");
	assertEquals(valueOf(ROOT, "--wsp-business-on"), "var(--on-tertiary)");
	// Every derived token is a mix OF the business hue, so one line re-anchors the whole family.
	for (const token of ["tint", "tint-hi", "edge", "ink"]) mixOf(ROOT, `--wsp-business-${token}`);
});

Deno.test("business hue: no --wsp-business* declaration reads --secondary or transparent", () => {
	const bad: string[] = [];
	for (const { name, css } of SHEETS) {
		for (const m of css.matchAll(/(--wsp-business[\w-]*)\s*:\s*([^;]+);/g)) {
			if (/--secondary\b|\btransparent\b/.test(m[2])) bad.push(`${name}: ${m[1]}: ${m[2].trim()}`);
		}
	}
	assertEquals(bad, [], "the business hue is --tertiary, every mix opaque (#230 (j), W1)");
});

Deno.test("business hue: high contrast widens the tint, the tint-hi, the edge AND the ink", () => {
	for (const token of ["tint", "tint-hi", "edge", "ink"]) {
		const normal = mixOf(ROOT, `--wsp-business-${token}`);
		const high = mixOf(HIGH, `--wsp-business-${token}`);
		assertEquals(high.space, normal.space, `--wsp-business-${token} changes its mixing space`);
		assertEquals(high.base, normal.base, `--wsp-business-${token} changes the tone it lands on`);
		// A tint or an edge widens by taking MORE hue; the ink widens by taking MORE --on-surface.
		const widened = token === "ink" ? high.share < normal.share : high.share > normal.share;
		assert(widened, `--wsp-business-${token} does not widen under high contrast`);
	}
});

Deno.test("business hue: no colour-vision overlay re-anchors the business side", () => {
	const overlays = SHEETS.flatMap(({ css }) => rules(css))
		.filter((rule) => /\[data-cvd=/.test(rule.selector));
	for (const overlay of overlays) {
		assert(
			!/--wsp-business/.test(overlay.body),
			`${overlay.selector} re-declares the business hue — it is --tertiary in every mode`,
		);
	}
});
// #endregion

// #region Measured
const BRAND_SEED = "#288690";
const SEEDS = [BRAND_SEED, "#7b2cbf", "#D98216"];
const AA = 4.5;
const AAA = 7;
const EDGE_FLOOR = 3;
/**
 * A NON-IDENTITY floor, not a visibility guarantee: the ring's ink (`--secondary`) and the business
 * hue must not be the same colour (they were ΔE_OK 0.00). They still share a tone — 1.00–1.01:1 in
 * luminance, ΔE_OK 0.03–0.05 (pinned below) — so a ring would not show against a business mark by
 * its ink alone; rings are off by directive, Decision #245 flag (a).
 */
const RING_DISTINCT_FLOOR = 0.025;

/**
 * The figures DESIGN_SYSTEM §A.1.3 and `workspace-tokens.css` publish for the brand seed, per state,
 * pinned to the two decimals they are printed with — so a change to a mix or to the engine that moves
 * one fails here instead of leaving the docs stale. `step` is the tint-hi step off the card, the
 * normal mix then the high-contrast one, both on the high-contrast tones; `ring` is the residual the
 * docs state: ΔE_OK and luminance contrast between the ring's ink and the hue.
 */
const PUBLISHED: Record<string, {
	inkOnTintHi: number;
	inkOnTint: number;
	inkOnSurface: number;
	onHue: number;
	edge: number;
	step?: [number, number];
	ring: { deltaE: number; contrast: number };
}> = {
	"light": {
		inkOnTintHi: 5.62,
		inkOnTint: 6.30,
		inkOnSurface: 7.21,
		onHue: 6.18,
		edge: 1.86,
		ring: { deltaE: 0.05, contrast: 1.01 },
	},
	"dark": {
		inkOnTintHi: 7.41,
		inkOnTint: 9.05,
		inkOnSurface: 11.09,
		onHue: 7.72,
		edge: 2.45,
		ring: { deltaE: 0.05, contrast: 1.00 },
	},
	"light + high contrast": {
		inkOnTintHi: 8.24,
		inkOnTint: 9.19,
		inkOnSurface: 12.85,
		onHue: 10.05,
		edge: 4.29,
		step: [1.35, 1.56],
		ring: { deltaE: 0.05, contrast: 1.00 },
	},
	"dark + high contrast": {
		inkOnTintHi: 7.34,
		inkOnTint: 8.94,
		inkOnSurface: 15.69,
		onHue: 14.60,
		edge: 7.05,
		step: [1.64, 2.14],
		ring: { deltaE: 0.03, contrast: 1.00 },
	},
};

/** A ratio as the docs print it. */
const dp2 = (n: number) => Number(n.toFixed(2));

for (const dark of [false, true]) {
	for (const highContrast of [false, true]) {
		const label = `${dark ? "dark" : "light"}${highContrast ? " + high contrast" : ""}`;

		Deno.test(`business hue: the mark, the edge and the filled pair clear their floors — ${label}`, () => {
			const at = (token: string) =>
				highContrast && valueOf(HIGH, `--wsp-business-${token}`)
					? mixOf(HIGH, `--wsp-business-${token}`)
					: mixOf(ROOT, `--wsp-business-${token}`);
			const floor = highContrast ? AAA : AA;
			for (const seed of SEEDS) {
				const s = buildScheme({ seed, dark, highContrast });
				const tone = (name: string) => rgb(s[`--${name}`]);
				const hue = tone("tertiary");
				const paint = (token: string) => {
					const m = at(token);
					return mix(hue, m, tone(m.base));
				};
				const [tint, tintHi, edge, ink] = ["tint", "tint-hi", "edge", "ink"].map(paint);
				const where = `(${label}, ${seed})`;
				const pairs: [string, number][] = [
					["ink on tint-hi (.wsp-mark)", contrast(ink, tintHi)],
					["ink on tint", contrast(ink, tint)],
					["--on-tertiary on the solid hue", contrast(tone("on-tertiary"), hue)],
				];
				for (const [what, ratio] of pairs) {
					assert(ratio >= floor, `${what} is ${ratio.toFixed(2)}:1 ${where}, owes ${floor}`);
				}
				if (highContrast) {
					const card = tone("surface-1");
					const edgeRatio = contrast(edge, card);
					assert(edgeRatio >= EDGE_FLOOR, `the edge is ${edgeRatio.toFixed(2)}:1 ${where}`);
					const normalHi = mix(hue, mixOf(ROOT, "--wsp-business-tint-hi"), card);
					assert(
						contrast(tintHi, card) > contrast(normalHi, card),
						`the tint-hi step does not widen ${where}`,
					);
				}
				const ring = deltaE(rgb(s["--focus-ring"]), hue);
				assert(
					ring >= RING_DISTINCT_FLOOR,
					`the ring's ink and the business hue are the same colour (ΔE ${
						ring.toFixed(3)
					}) ${where}`,
				);
			}
		});

		Deno.test(`business hue: the published brand-seed figures still hold to 2 dp — ${label}`, () => {
			const at = (token: string) =>
				highContrast && valueOf(HIGH, `--wsp-business-${token}`)
					? mixOf(HIGH, `--wsp-business-${token}`)
					: mixOf(ROOT, `--wsp-business-${token}`);
			const s = buildScheme({ seed: BRAND_SEED, dark, highContrast });
			const tone = (name: string) => rgb(s[`--${name}`]);
			const hue = tone("tertiary");
			const card = tone("surface-1");
			const paint = (token: string) => {
				const m = at(token);
				return mix(hue, m, tone(m.base));
			};
			const [tint, tintHi, edge, ink] = ["tint", "tint-hi", "edge", "ink"].map(paint);
			const ringInk = rgb(s["--focus-ring"]);
			const published = PUBLISHED[label];
			assertEquals(
				{
					inkOnTintHi: dp2(contrast(ink, tintHi)),
					inkOnTint: dp2(contrast(ink, tint)),
					inkOnSurface: dp2(contrast(ink, card)),
					onHue: dp2(contrast(tone("on-tertiary"), hue)),
					edge: dp2(contrast(edge, card)),
					...(published.step
						? {
							step: [
								dp2(contrast(mix(hue, mixOf(ROOT, "--wsp-business-tint-hi"), card), card)),
								dp2(contrast(tintHi, card)),
							] as [number, number],
						}
						: {}),
					ring: { deltaE: dp2(deltaE(ringInk, hue)), contrast: dp2(contrast(ringInk, hue)) },
				},
				published,
				`a published figure moved (${label}) — re-measure and update workspace-tokens.css and DESIGN_SYSTEM §A.1.3`,
			);
		});
	}
}
// #endregion
