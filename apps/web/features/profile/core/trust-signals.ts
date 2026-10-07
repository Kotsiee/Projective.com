import { ADORNMENT_META, type AdornmentSlug, rankAdornments } from "@projective/types/org";
import type { TrustAdornmentItem } from "@projective/ui/display";
import type { DevTrustAdornments } from "@web/utils/dev-seam.ts";

/** The inline items a profile's ranked trust signals render as. */
export function adornmentItems(slugs: readonly AdornmentSlug[]): TrustAdornmentItem[] {
	return slugs.map((slug) => {
		const meta = ADORNMENT_META[slug];
		return { id: slug, label: meta.label, description: meta.description, icon: meta.glyph };
	});
}

const SIMULATED: Readonly<Record<Exclude<DevTrustAdornments, "auto">, readonly AdornmentSlug[]>> = {
	none: [],
	earned: ["rated_4_8", "on_schedule", "quick_replies"],
	top: ["100_percent_recommended", "flawless_execution", "same_day_delivery"],
};

/**
 * The signals a hero shows: the stored ones, or the Dev Context Switcher's `trustAdornments`
 * position — ranked by the same rule either way, so the simulation exercises the shipping ranking.
 */
export function shownAdornments(
	stored: readonly AdornmentSlug[],
	position: DevTrustAdornments,
): AdornmentSlug[] {
	return rankAdornments(position === "auto" ? stored : SIMULATED[position]);
}
