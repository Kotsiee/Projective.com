/** @projective/ui/system — shared theming types. */

export type ThemeMode = "light" | "dark";
/**
 * What the viewer CHOSE, as opposed to what is painted ({@link ThemeMode}): a fixed mode, or
 * `"system"` — follow the operating system's `prefers-color-scheme`, live, and store nothing.
 */
export type ThemePreference = ThemeMode | "system";
export type CvdMode = "none" | "protan" | "deutan" | "tritan";

/** Input to the Material You scheme builder. */
export interface ThemeInput {
	/** Seed/brand color, hex (default brand teal `#288690`). */
	seed: string;
	/** Dark canvas when true. */
	dark: boolean;
	/** High-contrast accessibility theme — widens tonal separation (DESIGN_SYSTEM.md §A.5). */
	highContrast?: boolean;
}

/** The framework-level, user-adjustable configuration (DESIGN_SYSTEM.md §A.2/§A.5). */
export interface DesignSystemConfig {
	/** Brand/seed color; drives the Material You tonal palettes. */
	seed: string;
	mode: ThemeMode;
	/** Global border-radius multiplier (`--radius-scale`). */
	radiusScale: number;
	/** Global shadow-intensity multiplier (`--shadow-intensity`). */
	shadowIntensity: number;
	/** High-contrast accessibility theme. */
	highContrast: boolean;
	/** Reduced-motion preference (jump-to-final). */
	reducedMotion: boolean;
	/** Open-dyslexic typography mapping. */
	dyslexicFont: boolean;
	/** Color-vision-deficiency shift. */
	cvd: CvdMode;
}
