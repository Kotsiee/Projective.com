import { assert } from "@std/assert";
import { buildScheme } from "@projective/ui/system";

/**
 * The Overview's lifecycle pill (`.pjd-status`, `styles/project-dashboard.css`) is a SOLID fill under
 * a label, so it is held to the filled-control floor (root CLAUDE.md §3 gate 12): ≥ 4.5:1 in all four
 * mode/contrast states. The raw semantic pairs measure ~3.17:1 in light mode, which is why the sheet
 * mixes each role toward `--on-surface` instead of painting it straight. This restates that sheet's
 * two formulas over the generated scheme so a change to either the mix or the engine fails here.
 */

// #region [Colour math]
const AA_FLOOR = 4.5;
/** `color-mix(in srgb, var(--<role>) 70%, var(--on-surface))` — kept in step with the stylesheet. */
const ROLE_SHARE = 0.7;
/** `color-mix(in srgb, var(--on-surface-variant) 80%, var(--surface))` — the neutral fill. */
const NEUTRAL_SHARE = 0.8;
const SEEDS = ["#288690", "#7b2cbf", "#D98216"];

function rgb(hex: string): number[] {
	const n = parseInt(hex.slice(1, 7), 16);
	return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

function mix(a: string, share: number, b: string): number[] {
	const x = rgb(a);
	const y = rgb(b);
	return x.map((v, i) => Math.round(v * share + y[i] * (1 - share)));
}

function luminance(c: number[]): number {
	const [r, g, b] = c.map((v) => {
		const s = v / 255;
		return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
	});
	return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

function contrast(a: number[], b: number[]): number {
	const [hi, lo] = [luminance(a), luminance(b)].sort((p, q) => q - p);
	return (hi + 0.05) / (lo + 0.05);
}
// #endregion

// #region [Tests]
for (const dark of [false, true]) {
	for (const highContrast of [false, true]) {
		const label = `${dark ? "dark" : "light"}${highContrast ? " + high contrast" : ""}`;

		Deno.test(`pjd-status role fills clear ${AA_FLOOR}:1 — ${label}`, () => {
			for (const seed of SEEDS) {
				const s = buildScheme({ seed, dark, highContrast });
				for (const role of ["success", "warning", "danger", "info"]) {
					const fill = mix(s[`--${role}`], ROLE_SHARE, s["--on-surface"]);
					const ratio = contrast(fill, rgb(s[`--on-${role}`]));
					assert(
						ratio >= AA_FLOOR,
						`--on-${role} on the ${role} status fill is ${ratio.toFixed(2)}:1 (${label}, ${seed})`,
					);
				}
			}
		});

		Deno.test(`pjd-status neutral fill clears ${AA_FLOOR}:1 — ${label}`, () => {
			for (const seed of SEEDS) {
				const s = buildScheme({ seed, dark, highContrast });
				const fill = mix(s["--on-surface-variant"], NEUTRAL_SHARE, s["--surface"]);
				const ratio = contrast(fill, rgb(s["--surface"]));
				assert(ratio >= AA_FLOOR, `neutral status is ${ratio.toFixed(2)}:1 (${label}, ${seed})`);
			}
		});
	}
}
// #endregion
