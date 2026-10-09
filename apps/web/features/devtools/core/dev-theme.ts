/**
 * dev-theme.ts — the DEVELOPMENT-ONLY live theme knobs of the Context Switcher.
 *
 * Four `dsConfig` fields — the brand seed, the accent seed, the radius scale and the shadow
 * intensity — written through `updateConfig`, so the root binding's `applyConfig` repaints `:root`
 * in the same frame (the scheme tokens plus `--radius-scale` / `--shadow-intensity` as inline
 * properties, readable in the element inspector).
 *
 * Not persona simulation: the knobs ignore the master switch, have no `data-dev-*` seam (the theme
 * engine itself is the consumer) and reset on their own. The design system persists none of these
 * fields, so this module keeps a session copy only while a knob is off its default and re-applies
 * it when the Dev Tools island hydrates. Imported only by `apps/web/features/devtools/*`.
 */

import { DEFAULT_CONFIG, dsConfig, updateConfig } from "@projective/ui/system";
import { logger } from "@web/utils/logger.ts";
import { readStored, removeStored, SessionKeys, writeStored } from "@web/utils/storage-keys.ts";

// #region Shapes
/** The design-system fields the Theme group drives. */
export interface DevThemeKnobs {
	/** Brand seed (`dsConfig.seed`) — the primary and neutral palettes. */
	seed: string;
	/** Accent seed (`dsConfig.accentSeed`) — the `--accent` fill. */
	accentSeed: string;
	/** Multiplier behind every `--radius-*` token. */
	radiusScale: number;
	/** Multiplier behind every `--elevation-*` shadow. */
	shadowIntensity: number;
}

/** The bounds of a numeric theme knob. */
export interface DevThemeRange {
	min: number;
	max: number;
	step: number;
}

/** A numeric knob's key. */
export type DevThemeScaleKey = "radiusScale" | "shadowIntensity";
// #endregion

// #region Constants
/** The shipping values, read from `DEFAULT_CONFIG` so Reset can never drift from it. */
export const DEV_THEME_DEFAULTS: Readonly<DevThemeKnobs> = {
	seed: DEFAULT_CONFIG.seed,
	accentSeed: DEFAULT_CONFIG.accentSeed,
	radiusScale: DEFAULT_CONFIG.radiusScale,
	shadowIntensity: DEFAULT_CONFIG.shadowIntensity,
};

/** Slider bounds per numeric knob. */
export const DEV_THEME_RANGES: Readonly<Record<DevThemeScaleKey, DevThemeRange>> = {
	radiusScale: { min: 0, max: 1.6, step: 0.05 },
	shadowIntensity: { min: 0, max: 1.5, step: 0.05 },
};

const HEX_COLOUR = /^#[0-9a-f]{6}$/i;
// #endregion

// #region Reads
/** The knobs as the store holds them. Reads the signal, so a render that calls this subscribes. */
export function devThemeKnobs(): DevThemeKnobs {
	const cfg = dsConfig.value;
	return {
		seed: cfg.seed,
		accentSeed: cfg.accentSeed,
		radiusScale: cfg.radiusScale,
		shadowIntensity: cfg.shadowIntensity,
	};
}

/** Whether every knob sits at its shipping value (seeds compared case-insensitively). */
export function isDevThemeDefault(knobs: DevThemeKnobs): boolean {
	return knobs.seed.toLowerCase() === DEV_THEME_DEFAULTS.seed.toLowerCase() &&
		knobs.accentSeed.toLowerCase() === DEV_THEME_DEFAULTS.accentSeed.toLowerCase() &&
		knobs.radiusScale === DEV_THEME_DEFAULTS.radiusScale &&
		knobs.shadowIntensity === DEV_THEME_DEFAULTS.shadowIntensity;
}
// #endregion

// #region Writes
function persist(): void {
	const knobs = devThemeKnobs();
	if (isDevThemeDefault(knobs)) removeStored("session", SessionKeys.DEV_THEME_OVERRIDES);
	else writeStored("session", SessionKeys.DEV_THEME_OVERRIDES, JSON.stringify(knobs));
}

function clampToRange(value: number, range: DevThemeRange): number {
	return Math.min(range.max, Math.max(range.min, value));
}

function sanitize(value: unknown): Partial<DevThemeKnobs> {
	if (typeof value !== "object" || value === null) return {};
	const blob = value as Record<string, unknown>;
	const knobs: Partial<DevThemeKnobs> = {};
	if (typeof blob.seed === "string" && HEX_COLOUR.test(blob.seed)) knobs.seed = blob.seed;
	if (typeof blob.accentSeed === "string" && HEX_COLOUR.test(blob.accentSeed)) {
		knobs.accentSeed = blob.accentSeed;
	}
	for (const key of ["radiusScale", "shadowIntensity"] as const) {
		const raw = blob[key];
		if (typeof raw === "number" && Number.isFinite(raw)) {
			knobs[key] = clampToRange(raw, DEV_THEME_RANGES[key]);
		}
	}
	return knobs;
}

/** Repaint with `patch` applied and keep the session copy in step. */
export function patchDevTheme(patch: Partial<DevThemeKnobs>): void {
	updateConfig(patch);
	persist();
}

/** Restore the four shipping values and drop the session copy. */
export function resetDevTheme(): void {
	updateConfig({ ...DEV_THEME_DEFAULTS });
	removeStored("session", SessionKeys.DEV_THEME_OVERRIDES);
	logger.info("Dev theme reset", DEV_THEME_DEFAULTS);
}

/**
 * Re-apply the session copy, if any (client-only; call from an island effect). Invalid fields are
 * dropped one by one; an unparseable blob is discarded.
 */
export function hydrateDevTheme(): void {
	const raw = readStored("session", SessionKeys.DEV_THEME_OVERRIDES);
	if (!raw) return;
	let parsed: unknown;
	try {
		parsed = JSON.parse(raw);
	} catch (error) {
		removeStored("session", SessionKeys.DEV_THEME_OVERRIDES);
		logger.warn("Dev theme: discarded an unreadable session copy", { raw, error });
		return;
	}
	const knobs = sanitize(parsed);
	updateConfig(knobs);
	persist();
	logger.info("Dev theme restored", knobs);
}
// #endregion
