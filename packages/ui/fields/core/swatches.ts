/**
 * The swatch palette (Decision #408): "Default" and the eleven hues the `/files` folder menu offers, in
 * its order, as two rows of six. Each colour is a token pair in `styles/index.css` (`--swatch-<slug>`
 * with its `--on-swatch-<slug>` ink), mode-invariant so a colour reads the same to everyone who sees
 * it. A picker stores the token NAME, and `null` for the default.
 */

// #region Palette
/** One cell of the palette. */
export interface Swatch {
	/** What is stored: the token name, or `null` for the default. */
	token: string | null;
	/** The slug the token and the BEM modifier are named by. */
	slug: string;
	/** The spoken and shown name. */
	label: string;
}

/** How many swatches a row holds. */
export const SWATCH_COLUMNS = 6;

const COLOURS: readonly (readonly [string, string])[] = [
	["blue", "Blue"],
	["emerald", "Emerald"],
	["coral", "Coral"],
	["amber", "Amber"],
	["purple", "Purple"],
	["rose", "Rose"],
	["teal", "Teal"],
	["orange", "Orange"],
	["cyan", "Cyan"],
	["bronze", "Bronze"],
	["slate", "Slate"],
];

/** Every swatch, the default first. */
export const SWATCHES: readonly Swatch[] = [
	{ token: null, slug: "default", label: "Default" },
	...COLOURS.map(([slug, label]) => ({ token: `--swatch-${slug}`, slug, label })),
];

/** The swatch a stored token names; the default for none, or for a token that is no swatch. */
export function swatchFor(token: string | null | undefined): Swatch {
	return SWATCHES.find((s) => s.token !== null && s.token === token) ?? SWATCHES[0];
}
// #endregion

// #region Keyboard
/**
 * The cell an arrow key moves to from `index`, wrapping at the ends: left and right step one cell,
 * up and down a row, Home and End to the first and last. `null` for any other key.
 */
export function swatchStep(key: string, index: number, rtl = false): number | null {
	const count = SWATCHES.length;
	switch (key) {
		case "ArrowLeft":
			return (index + (rtl ? 1 : -1) + count) % count;
		case "ArrowRight":
			return (index + (rtl ? -1 : 1) + count) % count;
		case "ArrowUp":
			return (index - SWATCH_COLUMNS + count) % count;
		case "ArrowDown":
			return (index + SWATCH_COLUMNS) % count;
		case "Home":
			return 0;
		case "End":
			return count - 1;
		default:
			return null;
	}
}
// #endregion
