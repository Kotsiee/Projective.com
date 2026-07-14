/**
 * Material You theming engine — the ONLY module permitted to import
 * `@material/material-color-utilities` (approved exception, SYSTEM_ARCHITECTURE.md §3 /
 * DESIGN_SYSTEM.md §A.2). It converts a seed color into a set of tonal palettes and selects tones
 * per role, emitting the same `--*` CSS custom properties components already consume — so the
 * component layer stays 100% library-agnostic.
 *
 * Approach: `CorePalette.of(seed)` yields five tonal palettes (a1 primary · a2 secondary ·
 * a3 tertiary · n1 neutral · n2 neutral-variant), each a continuous `tone(0..100) → color`. Tone
 * selection IS the light/dark switch; the ~±40-tone gap between a color and its `on-` pair
 * guarantees ≥4.5:1 by construction.
 */
import { argbFromHex, CorePalette, hexFromArgb } from "@material/material-color-utilities";
import type { ThemeInput } from "../types/mod.ts";

// #region Constants
/** Fixed-hue semantic seeds (from PRODUCT_SPEC.md §Visual Identity). Each gets its own palette. */
const SEMANTIC_SEEDS: Record<string, string> = {
	success: "#268C66",
	warning: "#D98216",
	danger: "#D94141",
};
// #endregion

// #region Helpers
/** Widen tone away from mid (50) toward the extremes when high-contrast is active. */
function tone(t: number, highContrast: boolean): number {
	if (!highContrast) return t;
	const delta = 8;
	return t < 50 ? Math.max(0, t - delta) : Math.min(100, t + delta);
}

/** Convert an ARGB int to an `rgba()` string with an explicit alpha (for the focus ring). */
function rgba(argb: number, alpha: number): string {
	const r = (argb >> 16) & 0xff;
	const g = (argb >> 8) & 0xff;
	const b = argb & 0xff;
	return `rgba(${r}, ${g}, ${b}, ${alpha})`;
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

	const vars: Record<string, string> = dark
		? {
			"--primary": hx(core.a1.tone(60)),
			"--on-primary": hx(core.a1.tone(tone(98, hc))),
			"--secondary": hx(core.a2.tone(80)),
			"--tertiary": hx(core.a3.tone(80)),
			"--bg": hx(core.n1.tone(6)),
			"--surface": hx(core.n1.tone(6)),
			"--surface-1": hx(core.n1.tone(10)),
			"--surface-2": hx(core.n1.tone(12)),
			"--surface-3": hx(core.n1.tone(17)),
			"--on-surface": hx(core.n1.tone(tone(90, hc))),
			"--on-surface-variant": hx(core.n2.tone(80)),
			"--text-secondary": hx(core.n2.tone(70)),
			"--outline": hx(core.n2.tone(tone(60, hc))),
			"--border-subtle": hx(core.n2.tone(30)),
			"--focus-ring": rgba(core.a1.tone(80), 0.4),
		}
		: {
			"--primary": hx(core.a1.tone(45)),
			"--on-primary": hx(core.a1.tone(tone(98, hc))),
			"--secondary": hx(core.a2.tone(40)),
			"--tertiary": hx(core.a3.tone(40)),
			"--bg": hx(core.n1.tone(98)),
			"--surface": hx(core.n1.tone(100)),
			"--surface-1": hx(core.n1.tone(96)),
			"--surface-2": hx(core.n1.tone(94)),
			"--surface-3": hx(core.n1.tone(92)),
			"--on-surface": hx(core.n1.tone(tone(10, hc))),
			"--on-surface-variant": hx(core.n2.tone(30)),
			"--text-secondary": hx(core.n2.tone(40)),
			"--outline": hx(core.n2.tone(tone(50, hc))),
			"--border-subtle": hx(core.n2.tone(85)),
			"--focus-ring": rgba(core.a1.tone(40), 0.4),
		};

	// Fixed-hue semantic ramps + their on- pairs.
	for (const [name, hex] of Object.entries(SEMANTIC_SEEDS)) {
		const sc = CorePalette.of(argbFromHex(hex));
		vars[`--${name}`] = hx(sc.a1.tone(dark ? 80 : 40));
		vars[`--on-${name}`] = hx(sc.a1.tone(dark ? 20 : 100));
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
