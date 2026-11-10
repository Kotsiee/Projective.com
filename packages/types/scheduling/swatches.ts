import { z } from "zod";

/**
 * scheduling.swatches — the colour an availability rule or a calendar entry is drawn in (Decision
 * #408): "Default" and the eleven hues the `/files` folder menu offers, in the same order, as two rows
 * of six.
 *
 * A swatch is STORED as its CSS custom-property name (`--swatch-blue`) — `recurrence_rules.color_token`
 * and `events.accent` — never as a literal colour (root CLAUDE.md §3). The calendar paints a name
 * through its probe like any accent, and `@projective/ui/styles/index.css` declares each one with the
 * `--on-` ink twin the probe reads. `default` stores no name: the entry keeps its kind's colour.
 */

// #region Palette
/** Every swatch, in the grid's order. */
export const SWATCH_COLOR_TOKENS = [
	"default",
	"blue",
	"emerald",
	"coral",
	"amber",
	"purple",
	"rose",
	"teal",
	"orange",
	"cyan",
	"bronze",
	"slate",
] as const;

export const SwatchColorTokenSchema = z.enum(SWATCH_COLOR_TOKENS);
export type SwatchColorToken = z.infer<typeof SwatchColorTokenSchema>;

/** Each swatch's spoken and shown name. */
export const SWATCH_NAMES: Readonly<Record<SwatchColorToken, string>> = {
	default: "Default",
	blue: "Blue",
	emerald: "Emerald",
	coral: "Coral",
	amber: "Amber",
	purple: "Purple",
	rose: "Rose",
	teal: "Teal",
	orange: "Orange",
	cyan: "Cyan",
	bronze: "Bronze",
	slate: "Slate",
};
// #endregion

// #region Stored names
const PREFIX = "--swatch-";

/** The custom-property name a swatch is stored as; `default` stores none. */
export function swatchAccent(token: SwatchColorToken): string | null {
	return token === "default" ? null : `${PREFIX}${token}`;
}

/** The swatch a stored name is, or `default` for no name or a name that is not a swatch. */
export function swatchOf(stored: string | null | undefined): SwatchColorToken {
	if (!stored?.startsWith(PREFIX)) return "default";
	const parsed = SwatchColorTokenSchema.safeParse(stored.slice(PREFIX.length));
	return parsed.success ? parsed.data : "default";
}

/** A stored swatch name: one of the eleven colours (`default` is stored as `null`). */
export const SwatchAccentSchema = z.string().refine(
	(value) => swatchOf(value) !== "default",
	"Pick one of the swatches.",
);
// #endregion
