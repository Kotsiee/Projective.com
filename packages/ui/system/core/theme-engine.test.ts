import { assert } from "@std/assert";
import { buildScheme } from "./theme-engine.ts";

/**
 * Scrollbar contrast.
 *
 * The thumb is a graphical UI control drawn directly on a surface, so WCAG 2.2 SC 1.4.11 asks for
 * 3:1 against what it abuts. What it abuts is the TRACK, and the track is not one colour: it is
 * re-scoped per container to whatever surface the scroller sits on (`--scrollbar-track`,
 * `packages/ui/styles/index.css`), so the only honest assertion is against the WHOLE surface ramp.
 *
 * This is pinned by test because the failure is silent. The tones previously registered here
 * measured 1.00:1 against `--surface-3` in dark mode — the identical colour, an invisible thumb —
 * and nothing about reading the stylesheet says so. A ratio is a claim the product makes, and the
 * failure mode of an unchecked one is a control nobody can see rather than a broken layout.
 */
const SEED = "#288690";
/** Every token `--scrollbar-track` can resolve to. Kept in step with the scoping map in `styles/index.css`. */
const SURFACES = ["--bg", "--surface", "--surface-1", "--surface-2", "--surface-3"] as const;
/** WCAG 2.2 SC 1.4.11 non-text contrast. */
const FLOOR = 3;

function relativeLuminance(hex: string): number {
	const n = parseInt(hex.slice(1), 16);
	const channels = [(n >> 16) & 255, (n >> 8) & 255, n & 255].map((v) => {
		const s = v / 255;
		return s <= 0.03928 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4);
	});
	return 0.2126 * channels[0] + 0.7152 * channels[1] + 0.0722 * channels[2];
}

function contrast(a: string, b: string): number {
	const [hi, lo] = [relativeLuminance(a), relativeLuminance(b)].sort((x, y) => y - x);
	return (hi + 0.05) / (lo + 0.05);
}

for (const dark of [false, true]) {
	for (const highContrast of [false, true]) {
		const label = `${dark ? "dark" : "light"}${highContrast ? " + high contrast" : ""}`;
		Deno.test(`scrollbar thumb clears ${FLOOR}:1 on every surface — ${label}`, () => {
			const scheme = buildScheme({ seed: SEED, dark, highContrast });
			for (const state of ["--scrollbar-thumb", "--scrollbar-thumb-hover"] as const) {
				const thumb = scheme[state];
				assert(thumb, `${state} is not registered in the ${label} scheme`);
				for (const surface of SURFACES) {
					const ratio = contrast(thumb, scheme[surface]);
					assert(
						ratio >= FLOOR,
						`${state} (${thumb}) on ${surface} (${scheme[surface]}) is ${
							ratio.toFixed(2)
						}:1 in ${label} — below ${FLOOR}:1`,
					);
				}
			}
		});

		Deno.test(`scrollbar hover state is distinguishable from rest — ${label}`, () => {
			const scheme = buildScheme({ seed: SEED, dark, highContrast });
			// Not a WCAG threshold: a hover that is merely *different* is enough, but a hover that is
			// the SAME colour makes the state unobservable, which is the bug class this file exists for.
			assert(
				scheme["--scrollbar-thumb"] !== scheme["--scrollbar-thumb-hover"],
				`hover is byte-identical to rest in ${label}`,
			);
		});
	}
}

/**
 * The overlay must WIDEN the thumb, not merely change it. `fgTone` takes its direction from the
 * mode rather than from the tone's own position, and getting that backwards is how an accessibility
 * overlay comes to degrade the token it was meant to rescue (the bug documented on `fgTone` itself).
 */
Deno.test("high contrast widens the scrollbar thumb in both modes", () => {
	for (const dark of [false, true]) {
		const normal = buildScheme({ seed: SEED, dark });
		const high = buildScheme({ seed: SEED, dark, highContrast: true });
		for (const surface of SURFACES) {
			const before = contrast(normal["--scrollbar-thumb"], normal[surface]);
			const after = contrast(high["--scrollbar-thumb"], high[surface]);
			assert(
				after > before,
				`high contrast did not widen the thumb on ${surface} in ${dark ? "dark" : "light"}: ${
					before.toFixed(2)
				}:1 -> ${after.toFixed(2)}:1`,
			);
		}
	}
});

/**
 * The track is deliberately NOT a palette entry: it is a layout fact (which surface is this scroller
 * on?) and lives in CSS, scoped per surface. A hex registered here would be a second source of truth
 * that no amount of scoping could override on the engines that read `scrollbar-color`.
 */
Deno.test("the scrollbar track is not registered as a palette token", () => {
	for (const dark of [false, true]) {
		const scheme = buildScheme({ seed: SEED, dark });
		assert(
			!("--scrollbar-track" in scheme),
			"--scrollbar-track must be declared in styles/index.css, not the theme engine",
		);
	}
});
