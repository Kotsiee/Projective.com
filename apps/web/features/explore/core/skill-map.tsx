import type { SkillCategoryId } from "../types/explore-types.ts";

/**
 * Skill visual-category presentation — the label for a resolved {@link SkillCategoryId}.
 *
 * The pure keyword → category resolver lives server-side (the backend builds the fixtures with it); the
 * app only needs to NAME a category, in a skill link's accessible name and on filter chips. Skills print
 * as plain middot text (Decision #349), so the category glyphs that sat in the old pills are gone.
 */

// #region Labels
/** Human-readable category names (used in aria labels + filter chips). */
export const SKILL_CATEGORY_LABEL: Record<SkillCategoryId, string> = {
	technical: "Technical",
	design: "Design",
	motion: "Motion & video",
	content: "Content & writing",
	data: "Data",
	spatial: "3D & spatial",
	strategy: "Strategy",
	other: "General",
};
// #endregion
