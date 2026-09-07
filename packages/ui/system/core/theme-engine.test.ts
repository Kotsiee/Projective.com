import { assert, assertEquals } from "@std/assert";
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

/**
 * The filled-control contrast invariant (§B.12.2), and the brand-invariance rule it sits under.
 *
 * A filled button's ink is `--on-<role>` on a `--<role>` fill — the single most repeated colour
 * relationship in the product. It is pinned here because it failed silently for a long time and
 * nothing caught it: dark `--primary`/`--on-primary` was `fg(55)`/`on(98)`, both tones ABOVE mid,
 * which measured 3.57:1, and because `fgTone` widens a fill UP in dark mode while `onTone` widens an
 * `on-` role DOWN, the two CONVERGED under the high-contrast overlay and measured 1.75:1. The
 * accessibility setting made the control less readable, which is the exact inverse of its job, and no
 * amount of reading the stylesheet reveals it.
 */

/** Roles whose fill/ink polarity FOLLOWS the theme, and therefore widen under the HC overlay. */
const ADAPTIVE_PAIRS = [
	["--secondary", "--on-secondary"],
	["--tertiary", "--on-tertiary"],
] as const;
/** Every filled pair a `Button` severity can resolve to, brand included. */
const FILLED_PAIRS = [["--primary", "--on-primary"], ...ADAPTIVE_PAIRS] as const;

/** WCAG 2.2 SC 1.4.3 — normal-size text. A button label is normal-size text. */
const AA_FLOOR = 4.5;
/**
 * The stricter floor, and it applies ONLY to the mode-adaptive pairs.
 *
 * A pair free to re-tone per mode can straddle mid-tone and reach AAA, so it is held to it. The brand
 * pair cannot: it is byte-identical in all four states by construction (`BRAND_TONE`), so one ratio
 * has to serve every background the product has, and 5.13:1 is what a single mode-invariant pair
 * reaches. Holding it to 7:1 would be a test demanding the thing brand invariance forbids.
 */
const ADAPTIVE_DARK_FLOOR = 7;

for (const dark of [false, true]) {
	for (const highContrast of [false, true]) {
		const label = `${dark ? "dark" : "light"}${highContrast ? " + high contrast" : ""}`;

		Deno.test(`every filled pair clears ${AA_FLOOR}:1 — ${label}`, () => {
			const scheme = buildScheme({ seed: SEED, dark, highContrast });
			for (const [fill, ink] of FILLED_PAIRS) {
				assert(scheme[fill] && scheme[ink], `${fill}/${ink} missing from the ${label} scheme`);
				const ratio = contrast(scheme[fill], scheme[ink]);
				assert(
					ratio >= AA_FLOOR,
					`${ink} (${scheme[ink]}) on ${fill} (${scheme[fill]}) is ${
						ratio.toFixed(2)
					}:1 in ${label} — below the ${AA_FLOOR}:1 filled-control floor (§B.12.2)`,
				);
			}
		});

		Deno.test(`high contrast never narrows a filled pair — ${label}`, () => {
			const base = buildScheme({ seed: SEED, dark, highContrast: false });
			const hc = buildScheme({ seed: SEED, dark, highContrast: true });
			for (const [fill, ink] of FILLED_PAIRS) {
				const before = contrast(base[fill], base[ink]);
				const after = contrast(hc[fill], hc[ink]);
				assert(
					after >= before,
					`${fill}/${ink} measures ${before.toFixed(2)}:1 normally and ${
						after.toFixed(2)
					}:1 under high contrast in ${
						dark ? "dark" : "light"
					} — the overlay must widen a pair, or hold it, never close it`,
				);
			}
		});
	}
}

Deno.test(`mode-adaptive pairs clear ${ADAPTIVE_DARK_FLOOR}:1 in dark`, () => {
	for (const highContrast of [false, true]) {
		const scheme = buildScheme({ seed: SEED, dark: true, highContrast });
		for (const [fill, ink] of ADAPTIVE_PAIRS) {
			const ratio = contrast(scheme[fill], scheme[ink]);
			assert(
				ratio >= ADAPTIVE_DARK_FLOOR,
				`${ink} on ${fill} is ${
					ratio.toFixed(2)
				}:1 in dark${highContrast ? " + high contrast" : ""} — a pair free to re-tone per mode is held to ${ADAPTIVE_DARK_FLOOR}:1`,
			);
		}
	}
});

/**
 * Brand invariance (product owner, 2026-09-07).
 *
 * `--primary` and `--on-primary` are the core brand identity and must be **the same colour** in every
 * state the product can be in — not merely the same source expression. That distinction is the whole
 * reason this test exists: `fg(45)`/`on(98)` is one expression that resolves to two different colours,
 * because `fgTone` and `onTone` take the mode. Written that way the dark branch lands on tone 57 over
 * tone 86 under `data-contrast="high"` — `#0097a4` on `#63e9f9`, **2.44:1** — while light widens to
 * 8.42:1. Identical source, different brand, in the one state a struggling reader opts into.
 *
 * Asserted on the resolved hex across all four states, so it fails for a re-mapping in a mode branch,
 * for a re-introduced `fg()`/`on()` wrapper, and for a high-contrast carve-out alike.
 */
Deno.test("the brand pair is byte-identical in every mode and contrast state", () => {
	const states = [
		{ dark: false, highContrast: false },
		{ dark: false, highContrast: true },
		{ dark: true, highContrast: false },
		{ dark: true, highContrast: true },
	];
	const schemes = states.map((s) => ({ ...s, scheme: buildScheme({ seed: SEED, ...s }) }));
	const [reference] = schemes;
	for (const token of ["--primary", "--on-primary"] as const) {
		for (const { dark, highContrast, scheme } of schemes) {
			assertEquals(
				scheme[token],
				reference.scheme[token],
				`${token} is ${scheme[token]} in ${dark ? "dark" : "light"}${
					highContrast ? " + high contrast" : ""
				} but ${reference.scheme[token]} in light — the brand pair is mode-invariant (theme-engine \`BRAND_TONE\`)`,
			);
		}
	}
});

/**
 * The brand fill must still be FINDABLE on the page it sits on.
 *
 * A mode-invariant fill cannot move toward the background of whichever theme is active, so the one
 * value it has must clear WCAG 2.2 SC 1.4.11's 3:1 for a non-text UI component against every surface
 * it can be drawn on. This is the constraint that would break first if `BRAND_TONE` were ever pushed
 * darker to buy label contrast: the label would improve and the button would start disappearing into
 * the dark page.
 */
Deno.test("the brand fill clears 3:1 against every surface it can sit on", () => {
	for (const dark of [false, true]) {
		for (const highContrast of [false, true]) {
			const scheme = buildScheme({ seed: SEED, dark, highContrast });
			for (const surface of SURFACES) {
				const ratio = contrast(scheme["--primary"], scheme[surface]);
				assert(
					ratio >= FLOOR,
					`--primary (${scheme["--primary"]}) on ${surface} (${scheme[surface]}) is ${
						ratio.toFixed(2)
					}:1 in ${dark ? "dark" : "light"}${
						highContrast ? " + high contrast" : ""
					} — a filled control must clear ${FLOOR}:1 against its page (SC 1.4.11)`,
				);
			}
		}
	}
});

/**
 * The blend direction `button.css` depends on (§B.12.4).
 *
 * Hover and active mix the fill toward `--btn-shade`, which is only safe while that pole points AWAY
 * from the ink — otherwise pressure walks the two sides of the pair together and the label gets harder
 * to read the more the user interacts with it. Measured with the original brief's direction (mixing
 * toward `--btn-on`) a light-mode primary fell 5.13 → 4.42 → 4.12:1, under the AA floor.
 *
 * The pole is per-severity because polarity is not uniform, and this test is what proves the split is
 * needed rather than fussy: `--primary` is mode-invariant, so its ink stays LIGHT in dark mode while
 * every other role's flips DARK — and `--on-surface`, which flips with the theme, is therefore the
 * right pole for the others and the wrong one for the brand. Blending brand toward `--on-surface` in
 * dark measures 5.13 → 4.29:1.
 *
 * Asserted by REPRODUCING the two `color-mix()` declarations rather than by comparing tones, because
 * a tone relationship is a proxy and the ratio is the actual claim. If the mix in `button.css`
 * changes, this has to change with it — which is the point.
 */
const HOVER_MIX = 92;
const ACTIVE_MIX = 88;
/**
 * Mirrors the per-severity ramp in `packages/ui/fields/styles/button.css`.
 *
 * The pole is `--on-surface` for every role; what differs is the STEP. The brand takes 100% — no
 * luminance movement at all — because it has no headroom in either direction; see the zero-step test
 * below, which pins the measurements that decision rests on.
 */
const MIX_FOR: Record<string, { hover: number; active: number }> = {
	"--primary": { hover: 100, active: 100 },
	"--secondary": { hover: HOVER_MIX, active: ACTIVE_MIX },
	"--tertiary": { hover: HOVER_MIX, active: ACTIVE_MIX },
};

/** `color-mix(in srgb, a p%, b)` — sRGB, matching what the stylesheet resolves to. */
function mixSrgb(a: string, percent: number, b: string): string {
	const channels = (hex: string) => {
		const n = parseInt(hex.slice(1), 16);
		return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
	};
	const [x, y] = [channels(a), channels(b)];
	const f = percent / 100;
	return "#" + x
		.map((v, i) => Math.round(v * f + y[i] * (1 - f)).toString(16).padStart(2, "0"))
		.join("");
}

for (const dark of [false, true]) {
	for (const highContrast of [false, true]) {
		const label = `${dark ? "dark" : "light"}${highContrast ? " + high contrast" : ""}`;

		Deno.test(`pressing a filled control never lowers its contrast — ${label}`, () => {
			const scheme = buildScheme({ seed: SEED, dark, highContrast });
			for (const [fill, ink] of FILLED_PAIRS) {
				const rest = contrast(scheme[fill], scheme[ink]);
				const shade = scheme["--on-surface"];
				const step = MIX_FOR[fill];
				for (const [state, pct] of [["hover", step.hover], ["active", step.active]] as const) {
					const blended = mixSrgb(scheme[fill], pct, shade);
					const ratio = contrast(blended, scheme[ink]);
					assert(
						ratio >= rest,
						`${fill} ${state} blends to ${blended}, which measures ${ratio.toFixed(2)}:1 against ${ink} — below its own resting ${
							rest.toFixed(2)
						}:1 in ${label}. --btn-shade must point away from the ink (§B.12.4)`,
					);
				}
			}
		});
	}
}

/**
 * Why the brand takes a ZERO tonal step (§B.12.4), pinned as measurements rather than as a comment.
 *
 * A mode-invariant fill has one value that must satisfy two opposing constraints at once: readable
 * under a near-white ink (≥ 4.5:1) and findable on a near-black page (≥ 3:1 against every surface it
 * can sit on). In dark it clears both and barely — 5.13:1 and 3.05:1 — so a tonal step has to be paid
 * for out of whichever headroom it consumes, and darkening and lightening consume opposite ones.
 *
 * The decisive number is VISIBILITY: 0.05 of a ratio point. Any darkening at all puts the brand fill
 * under the non-text floor against `--surface-3` (measured 2.69:1 hovered, 2.51:1 pressed toward
 * `--scrim`). That leaves only lightening, and the standard 8% step lands the label on 4.53:1 —
 * over the floor by 0.03, which is not a margin, it is a rounding artefact that a re-seed would
 * erase. Hence 100%.
 *
 * If this fails, nothing is broken: the brand pair has GAINED headroom and the zero step can be
 * re-evaluated. Read it as an invitation, not a regression.
 */
/** Slack a floor needs before a decorative state may spend it. Below this, the budget is notional. */
const SPENDABLE_MARGIN = 0.25;

Deno.test("the brand fill has no headroom to spend on a tonal step in dark", () => {
	const scheme = buildScheme({ seed: SEED, dark: true, highContrast: false });
	const fill = scheme["--primary"];

	const visibilityHeadroom =
		Math.min(...SURFACES.map((s) => contrast(fill, scheme[s]))) - FLOOR;
	assert(
		visibilityHeadroom < SPENDABLE_MARGIN,
		`the brand fill now has ${
			visibilityHeadroom.toFixed(2)
		} of visibility headroom in dark — enough to darken on press. Re-evaluate the 100% --btn-mix-* on .ui-button (§B.12.4).`,
	);

	// The only direction left is lightening, and this is what the standard ramp costs the label.
	const lightened = mixSrgb(fill, HOVER_MIX, scheme["--on-surface"]);
	const labelHeadroom = contrast(lightened, scheme["--on-primary"]) - AA_FLOOR;
	assert(
		labelHeadroom < SPENDABLE_MARGIN,
		`an ${
			100 - HOVER_MIX
		}% lightening step now leaves ${labelHeadroom.toFixed(2)} of label headroom in dark — enough to afford a tonal hover. Re-evaluate the 100% --btn-mix-* on .ui-button (§B.12.4).`,
	);
});
