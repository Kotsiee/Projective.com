/**
 * pattern-glow — the physics of the Explore gateway's underlay glow (Decision #351), pure so it is
 * unit-tested apart from the canvas that draws it (`HeroPatternGlow`).
 *
 * A particle is born where the pointer moves. Over its life τ it fades and contracts from a wide wash
 * to a small point, so the path behind the pointer reads as a long tapering trail; its distance from
 * where the pointer is NOW only gently dims it, so the light peaks under the cursor without turning
 * into a spotlight.
 */

/** A particle's life τ, in ms: long enough that a sweep leaves a trail, not a spot. */
export const GLOW_LIFE_MS = 2200;

/** The radius a particle is born with, in CSS px (r₀). */
export const GLOW_RADIUS_START = 90;

/** The radius it contracts to by the end of its life, in CSS px. */
export const GLOW_RADIUS_END = 14;

/** The contraction's easing exponent: fast at first, settling as it shrinks. */
export const GLOW_RADIUS_EASE = 1.6;

/** The proximity falloff's coefficient, per px²: intensity halves about 447px from the cursor. */
export const GLOW_FALLOFF = 0.000005;

/** A particle's remaining life, 1 at birth to 0 at τ (clamped). */
export function glowLife(ageMs: number): number {
	return Math.min(1, Math.max(0, 1 - ageMs / GLOW_LIFE_MS));
}

/**
 * The radius at `ageMs`: `r₀ · (1 − t/τ)^1.6`, carried from {@link GLOW_RADIUS_START} down to
 * {@link GLOW_RADIUS_END} rather than to zero, so a dying particle ends as a small point of light.
 */
export function glowRadius(ageMs: number): number {
	return GLOW_RADIUS_END +
		(GLOW_RADIUS_START - GLOW_RADIUS_END) * glowLife(ageMs) ** GLOW_RADIUS_EASE;
}

/**
 * The intensity at `ageMs`, `distance` CSS px from the pointer's current position, as a share of the
 * peak: `(1 − t/τ) · 1 / (1 + 0.000005 · d²)`. The peak itself (I_peak) is the canvas's own opacity, so
 * overlapping particles saturate at it instead of stacking past it.
 */
export function glowIntensity(ageMs: number, distance: number): number {
	return glowLife(ageMs) / (1 + GLOW_FALLOFF * distance * distance);
}
