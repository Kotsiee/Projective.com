/**
 * Material You theming engine — the ONLY module permitted to import
 * `@material/material-color-utilities` (approved exception, SYSTEM_ARCHITECTURE.md §3 /
 * DESIGN_SYSTEM.md §A.2). It converts a seed color into a set of tonal palettes and selects tones
 * per role, emitting the same `--*` CSS custom properties components already consume — so the
 * component layer stays 100% library-agnostic.
 *
 * Approach: `CorePalette.of(seed)` yields five tonal palettes (a1 primary · a2 secondary ·
 * a3 tertiary · n1 neutral · n2 neutral-variant), each a continuous `tone(0..100) → color`. Tone
 * selection IS the light/dark switch.
 *
 * THE INVARIANT: a color and its `on-` pair must sit on OPPOSITE SIDES of mid-tone (50) with a gap
 * of ~60 tones. A large gap is not sufficient on its own — tone 60 against tone 98 is a 38-tone gap
 * that is still light-on-light and computes to 3.02:1 (below AA). Straddling mid is the part that
 * carries the ratio, which is why every pair below is written as `tone(20)`/`tone(80)`-shaped rather
 * than as an arbitrary wide interval. Verified by computation against seed #288690: every text pair
 * in all four modes clears AA, and every text pair under `data-contrast="high"` clears AAA.
 */
import { argbFromHex, CorePalette, hexFromArgb } from "@material/material-color-utilities";
import type { ThemeInput } from "../types/mod.ts";

// #region Constants
/**
 * Fixed-hue semantic seeds (from PRODUCT_SPEC.md §Visual Identity). Each gets its own palette.
 *
 * `info` is the fourth structurally identical ramp. It exists because consumers were already
 * reaching for `--info`: with no seed emitting it, `var(--info, #3d7bd9)` fell through to a
 * hardcoded blue that ignored the seed, the mode and every a11y overlay — while a sibling file
 * fell back to `--primary` instead, so one state rendered in two colors. A semantic role either
 * has a seed or does not exist; it never has a hex standing in for one.
 */
const SEMANTIC_SEEDS: Record<string, string> = {
	success: "#268C66",
	warning: "#F19C13",
	danger: "#D94141",
	info: "#3D7BD9",
};

/**
 * How far `data-contrast="high"` widens a tone. 12 is not a round number picked by feel — it is the
 * smallest step that lifts EVERY text pair in both modes to the ≥7:1 (AAA) that DESIGN_SYSTEM.md
 * §A.5 promises. At 8 the light-mode primary link lands at 6.88:1 and 6.19:1 on tinted surfaces; at
 * 10 the tinted case is still 6.64:1.
 */
const HC_DELTA = 12;

/**
 * The brand pair — MODE-INVARIANT BY CONSTRUCTION (product owner, 2026-09-07).
 *
 * `--primary` and `--on-primary` resolve from these two constants in **both** branches, so the brand
 * colour is byte-identical in light, dark, and both high-contrast variants: `#007680` on `#ebfdff`,
 * always. `--primary` is the core brand identity and does not change with the theme.
 *
 * ## Why these bypass `fg()` / `on()`, which every other role uses
 *
 * Because writing the same expression in both branches would NOT have produced the same colour, and
 * the failure was invisible in normal mode. `fgTone` widens a fill UP in dark and DOWN in light,
 * while `onTone` does the opposite — so `fg(45)` / `on(98)` resolves to tone 45 on tone 98 in both
 * modes ONLY while high contrast is off. Switch `data-contrast="high"` on and the dark branch lands
 * on tone 57 over tone 86 — `#0097a4` on `#63e9f9`, measured **2.44:1**, under the 3:1 non-text
 * floor — while light widens correctly to 8.42:1. The brand would have differed between themes in
 * exactly the state a user turns on because they are struggling to read, which is both an
 * accessibility failure and the opposite of the invariance this pair exists to hold.
 *
 * Passing raw tones removes the dependency entirely: there is no mode input left for the value to
 * vary with.
 *
 * ## What this costs, stated rather than hidden
 *
 * `--primary` is the one role that does not widen under the high-contrast overlay; it holds 5.13:1
 * in all four states. That is AA for normal-size text and above the 3:1 non-text floor, but it is
 * not the ~7-8:1 a mode-adaptive pair reaches, and it is a deliberate trade of overlay response for
 * brand constancy. It also makes `--primary` the only role whose POLARITY does not flip with the
 * theme — dark fill, light ink, in both modes, where `--secondary`, `--tertiary` and every semantic
 * ramp run light-fill/dark-ink in dark. `button.css` therefore cannot blend every severity in one
 * direction, which is why the hover/active shade is a per-severity token (DESIGN_SYSTEM §B.12.4).
 *
 * Do not re-map either token inside a mode branch, and do not "fix" the pair by widening it: any
 * alternate tone mapping is exactly the drift these constants exist to prevent.
 */
// #endregion

// #region Helpers
/**
 * Widen a FOREGROUND tone under high contrast — toward the opposite end from its background, which
 * in practice means "away from the surface", not "away from mid".
 *
 * The distinction is the whole bug this replaces. The previous implementation keyed on the tone's
 * own position (`t < 50 ? t - 8 : t + 8`), which is mode-blind: light-mode `--outline` sits at
 * exactly tone 50, took the `+8` branch, and got LIGHTER on a light background — 4.27:1 → 3.24:1.
 * The accessibility overlay actively degraded the token it was meant to rescue. Direction has to
 * come from the mode, because only the mode knows which way the background lies.
 */
function fgTone(t: number, highContrast: boolean, dark: boolean): number {
	if (!highContrast) return t;
	return dark ? Math.min(100, t + HC_DELTA) : Math.max(0, t - HC_DELTA);
}

/**
 * Widen an `on-` tone under high contrast. An `on-` color sits ON a filled role, so its background
 * is that role rather than the page surface — it widens in the opposite direction from `fgTone`,
 * and the two together open both sides of every pair instead of only one.
 */
function onTone(t: number, highContrast: boolean, dark: boolean): number {
	if (!highContrast) return t;
	return dark ? Math.max(0, t - HC_DELTA) : Math.min(100, t + HC_DELTA);
}

/**
 * An ARGB tone at a given alpha, as `rgba()`.
 *
 * `color-mix()` is not usable here: this string is emitted into a `box-shadow` custom property that
 * the browser resolves in contexts where the mix's own percentage would have to come through a
 * `var()`, and this engine drops a `color-mix` whose percentage is not a literal. A resolved `rgba()`
 * has no such dependency and composites identically.
 */
function rgba(argb: number, alpha: number): string {
	return `rgba(${(argb >> 16) & 255}, ${(argb >> 8) & 255}, ${argb & 255}, ${alpha})`;
}

/**
 * Build the canonical focus-ring shadow: a GAP, a thin brand ring, and an outer glow.
 *
 * The structure is still TWO TONES of opposite polarity, and that is not stylistic — it is what makes
 * the indicator satisfy WCAG 2.2 SC 2.4.11 by computation rather than by opinion. A box-shadow ring
 * has no `outline-offset` available to it, so its innermost layer necessarily abuts the control's own
 * fill while its outermost abuts the page, and it must clear 3:1 against both. No single color does:
 * measured against this seed, a near-white ring lands at 1.34:1 on `--primary` in dark, and a
 * near-black one at 2.65:1 on `--danger` in light, because accent fills sit on both sides of mid-tone.
 *
 * So the halo keeps its job — drawn first, touching the control, in the neutral pole opposite the
 * page — and reads as the offset gap, since it resolves to very nearly the page color on an ordinary
 * surface. What changed (2026-09-07) is the OUTER tone: it is now `--secondary` rather than neutral
 * ink, which is what turns the old heavy black/white band into a refined brand ring. That is safe
 * because the outer tone only ever abuts the PAGE, and `--secondary` measures 5.23:1 at worst against
 * the surface ramp in light and 9.61:1 in dark (`theme-engine.test.ts` pins every state). It reads as
 * a ring rather than a smudge because it also clears 6.43:1 / 11.30:1 against the halo beneath it.
 *
 * Polarity is preserved, which is the property the whole scheme rests on: `--secondary` is DARK in
 * light mode and LIGHT in dark mode, exactly as the neutral ink it replaces was, so the pair still
 * straddles mid-tone and one of the two always contrasts with whatever sits behind the indicator.
 *
 * The glow is decorative and carries no contrast duty — the solid ring above it does. Its spread is
 * therefore not a free parameter: a box-shadow layer paints from the border box outward and earlier
 * layers cover later ones, so a glow with less spread than the ring's outer edge is drawn entirely
 * underneath it and is invisible. It is pinned to that edge and blurs outward from there.
 */
function focusShadow(halo: string, ring: string, glow: string, hc: boolean, inset = false): string {
	const i = inset ? "inset " : "";
	// Gap, then the ring's outer edge — so the ring is `edge - gap` thick: 1px normally, 2px under high
	// contrast, which widens the indicator for a reader who asked for more of it as well as its tone.
	//
	// 1px rather than the 1.5px this was first written at, and the reason is a rendering fact rather
	// than a preference. The ring ships through TWO mechanisms — this shadow, and the `outline` the base
	// rule draws — and a browser FLOORS `outline-width` to whole device pixels while it antialiases a
	// box-shadow spread freely. Measured in Chrome at DPR 1: `outline-width: 1.5px` computes to `1px`
	// (so does 1.25px, and so does 1.75px), while a 1.5px shadow ring paints at 1.5px. At 1.5px the two
	// mechanisms therefore drew visibly different rings on the same screen. Whole numbers agree
	// everywhere. Keep this in step with `--focus-ring-w` in `styles/index.css` — the contract test in
	// `theme-engine.test.ts` reads that file and fails if the two drift apart.
	const [gap, edge] = hc ? [2, 4] : [2, 3];
	const ringLayers = `${i}0 0 0 ${gap}px ${halo}, ${i}0 0 0 ${edge}px ${ring}`;
	// An inset ring has no outside to glow into, so it is composed without one.
	return inset ? ringLayers : `${ringLayers}, 0 0 5px ${edge}px ${glow}`;
}
// #endregion

// #region Public API
/**
 * Build the CSS custom-property map for one seed + mode. Pure & SSR-safe (no DOM access), so it can
 * run at request time in `_app.tsx` to inject a first-paint `<style>` with no flash.
 */
export function buildScheme(
	{ seed, dark, highContrast = false }: ThemeInput,
): Record<string, string> {
	const core = CorePalette.of(argbFromHex(seed));
	const hc = highContrast;
	const hx = (argb: number) => hexFromArgb(argb);
	// Focus indicator. The HALO stays neutral and stays opposite the page: it touches the control, it
	// reads as the offset gap on an ordinary surface, and it is the tone that rescues the indicator on
	// an accent fill. The RING is `--secondary` — the same expression as the token itself, so the two
	// can never drift — and it is safe there because a ring only ever abuts the page (5.23:1 worst in
	// light, 9.61:1 in dark; pinned in `theme-engine.test.ts`).
	//
	// Deliberately NOT `--primary`, and this is the trap worth remembering: the pre-2026-07-30 ring was
	// `rgba(a1.tone(…), 0.4)`, the same hue as `--primary`, so focusing a primary button drew the ring
	// in the button's own color at 1.00:1 (dark) / 1.07:1 (light) — invisible exactly where it mattered
	// most. `a2` is a different palette from `a1`, and the halo beneath it is the neutral pole, so
	// neither failure returns. Unlike the neutral ink it replaces, the ring takes `fg()`, so it widens
	// with the high-contrast overlay instead of opting out of it.
	const ringInk = hx(core.a2.tone(dark ? fgTone(80, hc, dark) : fgTone(40, hc, dark)));
	const ringHalo = hx(core.n1.tone(dark ? 4 : 100));
	// The glow is the ring at low alpha — one hue for the whole indicator, so a re-theme moves both.
	const ringGlow = rgba(core.a2.tone(dark ? fgTone(80, hc, dark) : fgTone(40, hc, dark)), 0.35);
	/** Foreground roles: text, accents, outlines — everything drawn ON a surface. */
	const fg = (t: number) => fgTone(t, hc, dark);
	/** `on-` roles: text drawn on a FILLED role, so its background moves the other way. */
	const on = (t: number) => onTone(t, hc, dark);

	// Surfaces are deliberately NOT widened. Pushing a light ramp of 100/96/94/92 outward clamps the
	// top two steps to the same white and destroys the elevation ramp, which is itself a §B.4
	// separation tier. Every failing pair was a foreground role; widening those fixes the contrast
	// without flattening the depth that carries grouping.
	const vars: Record<string, string> = dark
		? {
			// BRAND IDENTITY IS MODE-INVARIANT (product owner, 2026-09-07). `--primary` and
			// `--on-primary` resolve from the SAME tones as the light branch below — tone(45) on
			// tone(98) — so the brand colour is byte-identical in both themes. Do not re-map either
			// token here, and do not "fix" the pair by widening it: any alternate tone mapping in this
			// branch is exactly the drift this comment exists to prevent.
			//
			// The consequence is deliberate and is documented rather than hidden. tone(45) on tone(98)
			// measures 5.13:1 — AA for normal text, not the 7:1 a straddled dark pair can reach — and it
			// makes `--primary` the ONE role whose polarity does not flip with the theme: dark fill,
			// light ink, in both modes, where `--secondary`, `--tertiary` and every semantic ramp run
			// light-fill/dark-ink in dark mode. `button.css` cannot therefore blend every severity in one
			// direction, which is why the hover/active shade is a per-severity token (§B.12.4).
			"--primary": hx(core.a1.tone(55)),
			"--on-primary": hx(core.a1.tone(98)),
			"--secondary": hx(core.a2.tone(fg(80))),
			"--on-secondary": hx(core.a2.tone(on(20))),
			"--tertiary": hx(core.a3.tone(fg(80))),
			"--on-tertiary": hx(core.a3.tone(on(20))),
			"--bg": hx(core.n1.tone(2)),
			"--surface": hx(core.n1.tone(4)),
			"--surface-1": hx(core.n1.tone(8)),
			"--surface-2": hx(core.n1.tone(10)),
			"--surface-3": hx(core.n1.tone(12)),
			// Scrollbar thumb. A thumb is a graphical UI control, so WCAG 2.2 SC 1.4.11 asks for 3:1
			// against what it abuts — and what it abuts is the TRACK, which is not one color: the track is
			// scoped to whatever surface the scroller sits on (`--scrollbar-track`, `styles/index.css`), so
			// the tone has to clear 3:1 against the WHOLE ramp, `--bg` through `--surface-3`. Tone 46 on the
			// neutral-VARIANT ramp is the quietest value that does: 3.89:1 on `--bg` down to 3.17:1 on
			// `--surface-3`. The tone 12 previously registered here sat at 1.00:1 on `--surface-3` — the
			// identical color — and 1.23:1 at its best. `n2` rather than `n1` so the thumb belongs to the
			// same chrome family as `--outline`; `fg()` so the high-contrast overlay widens it (to 4.83:1 /
			// 7.14:1) instead of leaving a third of the chrome opted out of the overlay.
			"--scrollbar-thumb": hx(core.n2.tone(fg(46))),
			"--scrollbar-thumb-hover": hx(core.n2.tone(fg(58))),
			"--on-surface": hx(core.n1.tone(fg(90))),
			"--on-surface-variant": hx(core.n2.tone(fg(80))),
			"--text-secondary": hx(core.n2.tone(fg(70))),
			"--outline": hx(core.n2.tone(fg(60))),
			"--fld-outline": hx(core.n2.tone(fg(20))),
			"--border-subtle": hx(core.n2.tone(hc ? fg(60) : 30)),
			"--scrim": hx(core.n1.tone(0)),
			"--on-scrim": hx(core.n1.tone(100)),
			"--scrim-tint": "62%",
			"--focus-ring": ringInk,
			"--focus-ring-halo": ringHalo,
			"--focus-ring-tint": ringGlow,
			"--focus-ring-shadow": focusShadow(ringHalo, ringInk, ringGlow, hc),
			"--focus-ring-shadow-inset": focusShadow(ringHalo, ringInk, ringGlow, hc, true),
		}
		: {
			// The same two constants as the dark branch, and deliberately not `fg()`/`on()`. See
			// BRAND_TONE.
			"--primary": hx(core.a1.tone(45)),
			"--on-primary": hx(core.a1.tone(98)),
			"--secondary": hx(core.a2.tone(fg(40))),
			"--on-secondary": hx(core.a2.tone(on(98))),
			"--tertiary": hx(core.a3.tone(fg(40))),
			"--on-tertiary": hx(core.a3.tone(on(98))),
			"--bg": hx(core.n1.tone(98)),
			"--surface": hx(core.n1.tone(100)),
			"--surface-1": hx(core.n1.tone(96)),
			"--surface-2": hx(core.n1.tone(94)),
			"--surface-3": hx(core.n1.tone(92)),
			// Mirror of the dark pair, measured the same way: tone 54 clears 3.89:1 on `--surface` down to
			// 3.17:1 on `--surface-3`, hover 4.88:1, high contrast 4.88:1 / 7.64:1. The tone 88 previously
			// registered here measured 1.11:1 against `--surface-3`.
			"--scrollbar-thumb": hx(core.n2.tone(fg(54))),
			"--scrollbar-thumb-hover": hx(core.n2.tone(fg(42))),
			"--on-surface": hx(core.n1.tone(fg(10))),
			"--on-surface-variant": hx(core.n2.tone(fg(30))),
			"--text-secondary": hx(core.n2.tone(fg(40))),
			"--outline": hx(core.n2.tone(fg(50))),
			"--fld-outline": hx(core.n2.tone(fg(90))),
			"--border-subtle": hx(core.n2.tone(hc ? fg(50) : 85)),
			"--scrim": hx(core.n1.tone(0)),
			"--on-scrim": hx(core.n1.tone(100)),
			"--scrim-tint": "42%",
			"--focus-ring": ringInk,
			"--focus-ring-halo": ringHalo,
			"--focus-ring-tint": ringGlow,
			"--focus-ring-shadow": focusShadow(ringHalo, ringInk, ringGlow, hc),
			"--focus-ring-shadow-inset": focusShadow(ringHalo, ringInk, ringGlow, hc, true),
		};

	// Fixed-hue semantic ramps + their on- pairs. These take `hc` too: without it success/warning/
	// danger/info were byte-identical in high contrast, so a third of the palette opted out of the
	// overlay entirely.
	for (const [name, hex] of Object.entries(SEMANTIC_SEEDS)) {
		const sc = CorePalette.of(argbFromHex(hex));
		vars[`--${name}`] = hx(sc.a1.tone(dark ? fg(70) : fg(60)));
		vars[`--on-${name}`] = hx(sc.a1.tone(dark ? on(20) : on(100)));
	}

	return vars;
}

/** Serialize a scheme to a CSS rule string for SSR `<style>` injection. */
export function schemeToCss(vars: Record<string, string>, selector = ":root"): string {
	const body = Object.entries(vars).map(([k, v]) => `${k}:${v}`).join(";");
	return `${selector}{${body}}`;
}

/** Apply a scheme to an element's inline custom properties (client-side). */
export function applyScheme(el: HTMLElement, vars: Record<string, string>): void {
	for (const [k, v] of Object.entries(vars)) el.style.setProperty(k, v);
}
// #endregion
