import { assert, assertEquals } from "@std/assert";
import { ACCENT_SEED, buildScheme } from "./theme-engine.ts";

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

/**
 * Roles whose fill/ink polarity FOLLOWS the theme, and therefore widen under the HC overlay.
 *
 * `--on-surface` / `--surface` is tier 2's monochrome inverted pair (§B.8.1, §D.7.7) — the fill of
 * `.ui-button--structural`, `.ui-lane-create` and the profile rig's `--mono` override. It is not a
 * severity, but it is a filled control's ink-on-fill relationship, so it answers to the same floors.
 * `--danger` is the one status ramp listed: every destructive commit is a filled Button (§B.8.3).
 */
const ADAPTIVE_PAIRS = [
	["--secondary", "--on-secondary"],
	["--tertiary", "--on-tertiary"],
	["--on-surface", "--surface"],
	["--danger", "--on-danger"],
] as const;
/** Every filled pair a `Button` severity or the structural tone can resolve to, brand included. */
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

/** A `text`/`link` danger Button inks its label in `--danger` straight on the page (§B.8.3). */
for (const dark of [false, true]) {
	for (const highContrast of [false, true]) {
		const label = `${dark ? "dark" : "light"}${highContrast ? " + high contrast" : ""}`;
		Deno.test(`--danger ink clears ${AA_FLOOR}:1 on every surface — ${label}`, () => {
			const scheme = buildScheme({ seed: SEED, dark, highContrast });
			for (const surface of SURFACES) {
				const ratio = contrast(scheme["--danger"], scheme[surface]);
				assert(
					ratio >= AA_FLOOR,
					`--danger (${scheme["--danger"]}) on ${surface} (${scheme[surface]}) is ${
						ratio.toFixed(2)
					}:1 in ${label} — a destructive label below the text floor`,
				);
			}
		});
	}
}

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
	"--danger": { hover: HOVER_MIX, active: ACTIVE_MIX },
	// `.ui-button--structural`: the fill IS the pole, so its hover is the border channel.
	"--on-surface": { hover: 100, active: 100 },
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

/**
 * The accent pair (§A.1.2, Decision #157) — amber, global, FIXED POLARITY.
 *
 * `--accent` / `--on-accent` is held to the whole filled-control rule: ≥ 4.5:1 in all four states,
 * ≥ 7:1 in dark, and never narrowed by the high-contrast overlay. It is pinned here on the resolved
 * hex because the failure this guards is the brand pair's: `fg()`/`on()` take their widening
 * direction from the mode, which assumes fill and ink swap sides with the theme. This pair never
 * swaps, so written `fg(62)`/`on(10)` the light pair converges under high contrast to 2.76:1.
 */
const ACCENT_STATES = [
	{ dark: false, highContrast: false, fill: "#d88115", ink: "#191c1d", ratio: "5.77" },
	{ dark: false, highContrast: true, fill: "#d88115", ink: "#000000", ratio: "7.07" },
	{ dark: true, highContrast: false, fill: "#e58b22", ink: "#0b0f0f", ratio: "7.39" },
	{ dark: true, highContrast: true, fill: "#ffb061", ink: "#000000", ratio: "11.63" },
] as const;

const stateLabel = (dark: boolean, highContrast: boolean) =>
	`${dark ? "dark" : "light"}${highContrast ? " + high contrast" : ""}`;

for (const { dark, highContrast, fill, ink, ratio } of ACCENT_STATES) {
	const label = stateLabel(dark, highContrast);

	Deno.test(`the accent pair resolves to its documented tones — ${label}`, () => {
		const scheme = buildScheme({ seed: SEED, dark, highContrast });
		assertEquals(scheme["--accent"], fill, `--accent in ${label}`);
		assertEquals(scheme["--on-accent"], ink, `--on-accent in ${label}`);
		assertEquals(
			contrast(scheme["--accent"], scheme["--on-accent"]).toFixed(2),
			ratio,
			`the §A.1.2 four-state table no longer matches the engine in ${label}`,
		);
	});

	Deno.test(`the accent pair clears ${AA_FLOOR}:1 — ${label}`, () => {
		const scheme = buildScheme({ seed: SEED, dark, highContrast });
		const measured = contrast(scheme["--accent"], scheme["--on-accent"]);
		assert(
			measured >= AA_FLOOR,
			`--on-accent on --accent is ${measured.toFixed(2)}:1 in ${label} — below ${AA_FLOOR}:1`,
		);
	});

	/** Light fill, dark ink in every state — the property that rules out `fg()`/`on()`. */
	Deno.test(`the accent pair keeps its polarity — ${label}`, () => {
		const scheme = buildScheme({ seed: SEED, dark, highContrast });
		assert(
			relativeLuminance(scheme["--accent"]) > relativeLuminance(scheme["--on-accent"]),
			`--accent (${scheme["--accent"]}) is not lighter than --on-accent (${
				scheme["--on-accent"]
			}) in ${label} — the pair is fixed-polarity (§A.1.2)`,
		);
	});

	/**
	 * Pressure blends the fill toward a mode-invariant LIGHT pole (`--on-scrim`, `N.tone(100)`), never
	 * toward `--btn-shade`: for a fixed-polarity light fill, `--on-surface` IS the ink in light mode.
	 * The accent severity in `button.css` must mirror this pole and these steps.
	 */
	Deno.test(`pressing the accent never lowers its contrast — ${label}`, () => {
		const scheme = buildScheme({ seed: SEED, dark, highContrast });
		const rest = contrast(scheme["--accent"], scheme["--on-accent"]);
		for (const [state, pct] of [["hover", HOVER_MIX], ["active", ACTIVE_MIX]] as const) {
			const blended = mixSrgb(scheme["--accent"], pct, scheme["--on-scrim"]);
			const measured = contrast(blended, scheme["--on-accent"]);
			assert(
				measured >= rest,
				`--accent ${state} blends to ${blended}, ${
					measured.toFixed(2)
				}:1 against --on-accent — below its resting ${rest.toFixed(2)}:1 in ${label}`,
			);
		}
	});
}

Deno.test(`the accent pair clears ${ADAPTIVE_DARK_FLOOR}:1 in dark`, () => {
	for (const highContrast of [false, true]) {
		const scheme = buildScheme({ seed: SEED, dark: true, highContrast });
		const measured = contrast(scheme["--accent"], scheme["--on-accent"]);
		assert(
			measured >= ADAPTIVE_DARK_FLOOR,
			`--on-accent on --accent is ${measured.toFixed(2)}:1 in ${
				stateLabel(true, highContrast)
			} — the accent re-tones per mode, so it is held to ${ADAPTIVE_DARK_FLOOR}:1`,
		);
	}
});

Deno.test("high contrast never narrows the accent pair", () => {
	for (const dark of [false, true]) {
		const base = buildScheme({ seed: SEED, dark, highContrast: false });
		const hc = buildScheme({ seed: SEED, dark, highContrast: true });
		const before = contrast(base["--accent"], base["--on-accent"]);
		const after = contrast(hc["--accent"], hc["--on-accent"]);
		assert(
			after > before,
			`--accent/--on-accent measures ${before.toFixed(2)}:1 normally and ${
				after.toFixed(2)
			}:1 under high contrast in ${dark ? "dark" : "light"} — the overlay must widen it`,
		);
	}
});

/** SSR (`_app.tsx`) builds schemes without an accent seed; the default must be the documented amber. */
Deno.test("omitting accentSeed is the same as passing ACCENT_SEED", () => {
	for (const { dark, highContrast } of ACCENT_STATES) {
		assertEquals(
			buildScheme({ seed: SEED, dark, highContrast }),
			buildScheme({ seed: SEED, accentSeed: ACCENT_SEED, dark, highContrast }),
		);
	}
});

/** A custom accent seed re-derives the fill and touches nothing else — the ink is the brand neutral. */
Deno.test("a custom accentSeed moves --accent and only --accent", () => {
	for (const { dark, highContrast } of ACCENT_STATES) {
		const base = buildScheme({ seed: SEED, dark, highContrast });
		const custom = buildScheme({ seed: SEED, accentSeed: "#3D7BD9", dark, highContrast });
		assert(
			custom["--accent"] !== base["--accent"],
			`accentSeed was ignored in ${stateLabel(dark, highContrast)}`,
		);
		const { ["--accent"]: _a, ...restCustom } = custom;
		const { ["--accent"]: _b, ...restBase } = base;
		assertEquals(restCustom, restBase, "a custom accent seed leaked into another token");
	}
});

/**
 * The focus indicator (§A.5, WCAG 2.2 SC 2.4.11 / SC 1.4.11).
 *
 * Pinned by test because every way this can fail is silent. The ring is `--secondary`, which is only
 * legal because an `outline-offset` (or, for the box-shadow composite, the halo beneath it) keeps it
 * off the control's own fill: measured against this seed it lands at 1.00:1 on a `--secondary` fill
 * and 1.19:1 on `--primary`. Against the PAGE it is comfortable. So what these tests actually defend
 * is the assumption the geometry rests on — that the ring's only neighbours are a surface and the
 * halo — and they will fail loudly if a re-seed or a re-tone breaks it.
 */
const RING = "--focus-ring";

for (const dark of [false, true]) {
	for (const highContrast of [false, true]) {
		const label = `${dark ? "dark" : "light"}${highContrast ? " + high contrast" : ""}`;
		const scheme = buildScheme({ seed: SEED, dark, highContrast });

		Deno.test(`focus ring clears ${FLOOR}:1 on every surface — ${label}`, () => {
			for (const surface of SURFACES) {
				const ratio = contrast(scheme[RING], scheme[surface]);
				assert(
					ratio >= FLOOR,
					`focus ring ${scheme[RING]} on ${surface} ${scheme[surface]} measures ${
						ratio.toFixed(2)
					}:1 in ${label} — an indicator nobody can see`,
				);
			}
		});

		/**
		 * The ring is drawn directly outside the halo, so it has to separate from it as well as from
		 * the page — otherwise the two read as one thick band and the refinement is lost.
		 */
		Deno.test(`focus ring separates from its own halo — ${label}`, () => {
			const ratio = contrast(scheme[RING], scheme["--focus-ring-halo"]);
			assert(
				ratio >= FLOOR,
				`ring ${scheme[RING]} against halo ${
					scheme["--focus-ring-halo"]
				} measures ${ratio.toFixed(2)}:1 in ${label}`,
			);
		});

		/**
		 * Polarity is the property the two-tone scheme rests on: whatever sits behind the indicator,
		 * one of the two tones contrasts with it. That only holds while the pair straddles mid-tone.
		 */
		Deno.test(`focus ring and halo straddle mid-tone — ${label}`, () => {
			const ring = relativeLuminance(scheme[RING]);
			const halo = relativeLuminance(scheme["--focus-ring-halo"]);
			assert(
				(ring > halo) === dark,
				`ring and halo do not straddle in ${label} — in dark the ring must be the LIGHT tone and in light the DARK one, or the pair stops rescuing accent fills`,
			);
		});

		/** One hue for the whole indicator: the ring IS the secondary token, not a copy of it. */
		Deno.test(`focus ring is the secondary token itself — ${label}`, () => {
			assertEquals(scheme[RING], scheme["--secondary"]);
		});
	}
}

/** The overlay must widen the indicator, never leave it out — the defect `--primary` still has. */
Deno.test("high contrast never narrows the focus ring", () => {
	for (const dark of [false, true]) {
		const base = buildScheme({ seed: SEED, dark });
		const hc = buildScheme({ seed: SEED, dark, highContrast: true });
		for (const surface of SURFACES) {
			const before = contrast(base[RING], base[surface]);
			const after = contrast(hc[RING], hc[surface]);
			assert(
				after >= before,
				`the focus ring narrowed on ${surface} under high contrast in ${
					dark ? "dark" : "light"
				}: ${before.toFixed(2)}:1 → ${after.toFixed(2)}:1`,
			);
		}
	}
});

/**
 * The glow's spread is pinned to the ring's outer edge. A box-shadow layer paints from the border box
 * outward and earlier layers cover later ones, so a glow with LESS spread than the ring is painted
 * entirely underneath it — present in the value, invisible on screen, and undetectable by reading it.
 */
Deno.test("the glow is not painted underneath the ring", () => {
	for (const dark of [false, true]) {
		for (const highContrast of [false, true]) {
			const shadow = buildScheme({ seed: SEED, dark, highContrast })["--focus-ring-shadow"];
			const layers = shadow.split(/,(?![^(]*\))/).map((l) => l.trim());
			assertEquals(layers.length, 3, `expected gap + ring + glow, got: ${shadow}`);
			const spread = (layer: string) => {
				const px = layer.match(/(\d+(?:\.\d+)?)px/g) ?? [];
				return parseFloat(px[px.length - 1]);
			};
			assert(
				spread(layers[2]) >= spread(layers[1]),
				`glow spread ${spread(layers[2])}px is inside the ring edge ${
					spread(layers[1])
				}px — it would be invisible`,
			);
		}
	}
});

/** An inset ring has no outside, so composing a glow for it would paint a band nobody asked for. */
Deno.test("the inset ring carries no glow", () => {
	const inset = buildScheme({ seed: SEED, dark: false })["--focus-ring-shadow-inset"];
	assertEquals(inset.split(/,(?![^(]*\))/).length, 2);
	assert(inset.split("inset").length - 1 === 2, `every inset layer must say so: ${inset}`);
});

/**
 * The ring's thickness is stated twice — as `--focus-ring-w` in `styles/index.css`, which the base
 * `outline` rule reads, and as the gap/edge pair in `focusShadow()`, which the 556 box-shadow call
 * sites read. Two numbers, two languages, one indicator: nothing but this test stops them drifting,
 * and the symptom of drift is a product where the same ring is one thickness on a button and another
 * on the input beside it.
 *
 * It reads the stylesheet rather than a copy of its values, so it fails on the real edit.
 */
Deno.test("the outline ring and the shadow ring are the same thickness", async () => {
	const css = await Deno.readTextFile(new URL("../../styles/index.css", import.meta.url));

	const widthIn = (block: string) => {
		const m = block.match(/--focus-ring-w:\s*([\d.]+)px/);
		assert(m, "--focus-ring-w not found");
		return parseFloat(m![1]);
	};
	// The high-contrast override lives in its own `:root[data-contrast="high"]` block.
	const hcStart = css.indexOf('[data-contrast="high"]');
	assert(hcStart > 0, "high-contrast block not found");
	const base = widthIn(css.slice(0, hcStart));
	const high = widthIn(css.slice(hcStart));

	const shadowRing = (highContrast: boolean) => {
		const layers = buildScheme({ seed: SEED, dark: false, highContrast })["--focus-ring-shadow"]
			.split(/,(?![^(]*\))/);
		const px = (l: string) => parseFloat((l.match(/([\d.]+)px/g) ?? []).slice(-1)[0]);
		return px(layers[1]) - px(layers[0]); // edge − gap
	};

	assertEquals(base, shadowRing(false), "base ring thickness disagrees between CSS and the engine");
	assertEquals(high, shadowRing(true), "high-contrast ring disagrees between CSS and the engine");

	// Whole pixels, because `outline-width` is floored to them and a fraction silently renders thinner.
	assertEquals(base, Math.round(base), `--focus-ring-w ${base}px is fractional and will floor`);
	assertEquals(high, Math.round(high), `high-contrast --focus-ring-w ${high}px is fractional`);
	assert(high > base, "high contrast must widen the ring, not merely retint it");
});

/**
 * Opaque status tints (`--success-tint` · `--warning-tint` · `--danger-tint` · `--primary-tint`).
 *
 * A tint is a region fill that body text sits on, so the claim it makes is the text one: `--on-surface`
 * on it clears 4.5:1 (WCAG 2.2 SC 1.4.3) in every mode/contrast state. The tokens are CSS — a
 * `color-mix()` over engine-emitted roles — so this reads the mix strength per state from the
 * stylesheet and re-derives the composite here, in OKLab, exactly as the browser does. It fails on
 * the real edit: retuning `--status-tint-mix` in any state block is measured, not trusted.
 */
const TINT_RAMPS = ["--success", "--warning", "--danger", "--primary"] as const;

/** Each state's two selectors: the explicit attribute and its `prefers-contrast` twin. */
const TINT_STATES = [
	{ dark: false, highContrast: false, selectors: [":root"] },
	{ dark: true, highContrast: false, selectors: [':root[data-theme="dark"]'] },
	{
		dark: false,
		highContrast: true,
		selectors: [':root[data-contrast="high"]', ':root:not([data-contrast="normal"])'],
	},
	{
		dark: true,
		highContrast: true,
		selectors: [
			':root[data-theme="dark"][data-contrast="high"]',
			':root[data-theme="dark"]:not([data-contrast="normal"])',
		],
	},
] as const;

/** Every flat rule in the sheet (media-nested rules included) as selector → declarations, first wins. */
async function cssRules(): Promise<Map<string, Map<string, string>>> {
	const css = (await Deno.readTextFile(new URL("../../styles/index.css", import.meta.url)))
		.replace(/\/\*[\s\S]*?\*\//g, "");
	const rules = new Map<string, Map<string, string>>();
	for (const [, selector, body] of css.matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
		const key = selector.trim();
		const decls = rules.get(key) ?? new Map<string, string>();
		for (const [, prop, value] of body.matchAll(/(--[\w-]+)\s*:\s*([^;]+);/g)) {
			if (!decls.has(prop)) decls.set(prop, value.trim());
		}
		rules.set(key, decls);
	}
	return rules;
}

/** Resolve a `--status-tint-mix` value (`var(--tint-*)` or a literal %) to a fraction. */
function tintFraction(value: string, root: Map<string, string>): number {
	const ref = value.match(/^var\((--[\w-]+)\)$/);
	const resolved = ref ? root.get(ref[1]) : value;
	assert(resolved?.endsWith("%"), `--status-tint-mix ${value} does not resolve to a percentage`);
	return parseFloat(resolved!) / 100;
}

function hexToLinear(hex: string): number[] {
	const n = parseInt(hex.slice(1), 16);
	return [(n >> 16) & 255, (n >> 8) & 255, n & 255].map((v) => {
		const s = v / 255;
		return s <= 0.04045 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4);
	});
}

function linearToHex(rgb: number[]): string {
	return "#" + rgb.map((v) => {
		const c = Math.min(1, Math.max(0, v));
		const s = c <= 0.0031308 ? c * 12.92 : 1.055 * Math.pow(c, 1 / 2.4) - 0.055;
		return Math.round(s * 255).toString(16).padStart(2, "0");
	}).join("");
}

function linearToOklab([r, g, b]: number[]): number[] {
	const l = Math.cbrt(0.4122214708 * r + 0.5363325363 * g + 0.0514459929 * b);
	const m = Math.cbrt(0.2119034982 * r + 0.6806995451 * g + 0.1073969566 * b);
	const s = Math.cbrt(0.0883024619 * r + 0.2817188376 * g + 0.6299787005 * b);
	return [
		0.2104542553 * l + 0.793617785 * m - 0.0040720468 * s,
		1.9779984951 * l - 2.428592205 * m + 0.4505937099 * s,
		0.0259040371 * l + 0.7827717662 * m - 0.808675766 * s,
	];
}

function oklabToLinear([L, a, b]: number[]): number[] {
	const l = (L + 0.3963377774 * a + 0.2158037573 * b) ** 3;
	const m = (L - 0.1055613458 * a - 0.0638541728 * b) ** 3;
	const s = (L - 0.0894841775 * a - 1.291485548 * b) ** 3;
	return [
		4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s,
		-1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s,
		-0.0041960863 * l - 0.7034186147 * m + 1.707614701 * s,
	];
}

/** `color-mix(in oklab, a p, b)` — `p` as a fraction, the remainder going to `b`. */
function mixOklab(a: string, p: number, b: string): string {
	const [x, y] = [linearToOklab(hexToLinear(a)), linearToOklab(hexToLinear(b))];
	return linearToHex(oklabToLinear(x.map((v, i) => v * p + y[i] * (1 - p))));
}

Deno.test("every status tint is an opaque OKLab mix against --surface-1", async () => {
	const root = (await cssRules()).get(":root")!;
	for (const ramp of TINT_RAMPS) {
		const value = root.get(`${ramp}-tint`);
		assertEquals(
			value,
			`color-mix(in oklab, var(${ramp}) var(--status-tint-mix), var(--surface-1))`,
			`${ramp}-tint must mix against a solid surface — never \`transparent\` (§B.4.2)`,
		);
	}
});

Deno.test("both high-contrast channels agree on the tint strength", async () => {
	const rules = await cssRules();
	for (const { selectors } of TINT_STATES) {
		const values = selectors.map((s) => rules.get(s)?.get("--status-tint-mix"));
		for (const [i, v] of values.entries()) {
			assert(v, `--status-tint-mix is not declared under ${selectors[i]}`);
		}
		assertEquals(
			new Set(values).size,
			1,
			`${selectors.join(" vs ")} disagree: ${values.join(" vs ")}`,
		);
	}
});

for (const state of TINT_STATES) {
	const label = `${state.dark ? "dark" : "light"}${state.highContrast ? " + high contrast" : ""}`;
	Deno.test(`--on-surface clears ${AA_FLOOR}:1 on every status tint — ${label}`, async () => {
		const rules = await cssRules();
		const p = tintFraction(
			rules.get(state.selectors[0])!.get("--status-tint-mix")!,
			rules.get(":root")!,
		);
		const scheme = buildScheme({ seed: SEED, dark: state.dark, highContrast: state.highContrast });
		for (const ramp of TINT_RAMPS) {
			const tint = mixOklab(scheme[ramp], p, scheme["--surface-1"]);
			assert(
				tint !== scheme["--surface-1"],
				`${ramp}-tint is indistinguishable from --surface-1 in ${label}`,
			);
			const ratio = contrast(scheme["--on-surface"], tint);
			assert(
				ratio >= AA_FLOOR,
				`--on-surface (${scheme["--on-surface"]}) on ${ramp}-tint (${tint}) is ${
					ratio.toFixed(2)
				}:1 in ${label} — below ${AA_FLOOR}:1`,
			);
		}
	});
}

Deno.test("high contrast never narrows ink on a status tint", async () => {
	const rules = await cssRules();
	const root = rules.get(":root")!;
	const ratioFor = (state: (typeof TINT_STATES)[number], ramp: string) => {
		const p = tintFraction(rules.get(state.selectors[0])!.get("--status-tint-mix")!, root);
		const scheme = buildScheme({ seed: SEED, dark: state.dark, highContrast: state.highContrast });
		return contrast(scheme["--on-surface"], mixOklab(scheme[ramp], p, scheme["--surface-1"]));
	};
	for (const dark of [false, true]) {
		const [base, hc] = [false, true].map((h) =>
			TINT_STATES.find((s) => s.dark === dark && s.highContrast === h)!
		);
		for (const ramp of TINT_RAMPS) {
			const before = ratioFor(base, ramp);
			const after = ratioFor(hc, ramp);
			assert(
				after >= before,
				`${ramp}-tint ink narrowed under high contrast in ${dark ? "dark" : "light"}: ${
					before.toFixed(2)
				}:1 -> ${after.toFixed(2)}:1`,
			);
		}
	}
});
