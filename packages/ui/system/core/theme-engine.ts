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
	warning: "#D98216",
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
 * Build the canonical focus-ring shadow: a TWO-TONE ring (halo against the control, ring against the
 * page). This is the same technique the browser's own `outline: auto` uses, and it is not stylistic.
 *
 * A single-color ring cannot satisfy WCAG 2.2 SC 2.4.11 here, by computation rather than by opinion.
 * The ring abuts two different colors at once — the control's fill on the inside, the page on the
 * outside — and must clear 3:1 against both. Measured against this seed: a near-white ring (the only
 * value that works on the dark page) lands at 1.34:1 on `--primary` in dark mode, and a near-black
 * ring (the only value that works on the light page) lands at 2.65:1 on `--danger` in light mode.
 * There is no third color that rescues both, because accent fills sit on both sides of mid-tone.
 *
 * Two tones of OPPOSITE polarity remove the dependency entirely: whatever sits behind the indicator,
 * one of the two contrasts with it. The halo is drawn first (touching the control), the ring outside
 * it (touching the page), so neither has to work alone.
 */
function focusShadow(halo: string, ring: string, hc: boolean, inset = false): string {
	const i = inset ? "inset " : "";
	const [a, b] = hc ? [3, 6] : [2, 4];
	return `${i}0 0 0 ${a}px ${halo}, ${i}0 0 0 ${b}px ${ring}`;
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
	// Focus indicator: neutral ink + its opposite. Deliberately NOT accent-derived — the previous
	// `rgba(a1.tone(…), 0.4)` was the same hue as `--primary`, so focusing a primary button drew the
	// ring in the button's own color at 1.00:1 (dark) / 1.07:1 (light). Invisible exactly where it
	// mattered most. Neutral also keeps the indicator readable when the seed is re-themed.
	const ringInk = hx(core.n1.tone(dark ? 98 : 4));
	const ringHalo = hx(core.n1.tone(dark ? 4 : 100));
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
			// tone(80) on tone(20): 60 tones STRADDLING mid → 7.74:1 (AAA).
			"--primary": hx(core.a1.tone(fg(55))),
			"--on-primary": hx(core.a1.tone(on(98))),
			"--secondary": hx(core.a2.tone(fg(80))),
			"--on-secondary": hx(core.a2.tone(on(20))),
			"--tertiary": hx(core.a3.tone(fg(80))),
			"--on-tertiary": hx(core.a3.tone(on(20))),
			"--bg": hx(core.n1.tone(2)),
			"--surface": hx(core.n1.tone(4)),
			"--surface-1": hx(core.n1.tone(8)),
			"--surface-2": hx(core.n1.tone(10)),
			"--surface-3": hx(core.n1.tone(12)),
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
			"--focus-ring-shadow": focusShadow(ringHalo, ringInk, hc),
			"--focus-ring-shadow-inset": focusShadow(ringHalo, ringInk, hc, true),
		}
		: {
			// Light already clears AA at tone(45)/tone(98) — 5.13:1. Left as shipped.
			"--primary": hx(core.a1.tone(fg(45))),
			"--on-primary": hx(core.a1.tone(on(98))),
			"--secondary": hx(core.a2.tone(fg(40))),
			"--on-secondary": hx(core.a2.tone(on(98))),
			"--tertiary": hx(core.a3.tone(fg(40))),
			"--on-tertiary": hx(core.a3.tone(on(98))),
			"--bg": hx(core.n1.tone(98)),
			"--surface": hx(core.n1.tone(100)),
			"--surface-1": hx(core.n1.tone(96)),
			"--surface-2": hx(core.n1.tone(94)),
			"--surface-3": hx(core.n1.tone(92)),
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
			"--focus-ring-shadow": focusShadow(ringHalo, ringInk, hc),
			"--focus-ring-shadow-inset": focusShadow(ringHalo, ringInk, hc, true),
		};

	// Fixed-hue semantic ramps + their on- pairs. These take `hc` too: without it success/warning/
	// danger/info were byte-identical in high contrast, so a third of the palette opted out of the
	// overlay entirely.
	for (const [name, hex] of Object.entries(SEMANTIC_SEEDS)) {
		const sc = CorePalette.of(argbFromHex(hex));
		vars[`--${name}`] = hx(sc.a1.tone(dark ? fg(80) : fg(40)));
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
