import type { VNode } from "preact";
import type { SkillCategoryId } from "../types/explore-types.ts";

/**
 * Skill visual-category presentation — the glyph + label for a resolved {@link SkillCategoryId}.
 *
 * The pure keyword → category resolver lives server-side (the backend builds the fixtures with it); the
 * app only needs to RENDER a category, so this module keeps the descriptive glyph (e.g. `</>` for
 * technical work) and the human label used on pills + filter chips.
 */

// #region Icons
/**
 * Category glyphs. Pure inline SVG, `currentColor`, token-sized by the pill — no hardcoded colour.
 * `aria-hidden` because the adjacent label already names the skill.
 */
function svg(children: VNode | VNode[]): VNode {
	return (
		<svg
			viewBox="0 0 24 24"
			fill="none"
			stroke="currentColor"
			stroke-width="1.9"
			stroke-linecap="round"
			stroke-linejoin="round"
			aria-hidden="true"
		>
			{children}
		</svg>
	);
}

const ICONS: Record<SkillCategoryId, () => VNode> = {
	technical: () => svg([<path key="l" d="m8 8-4 4 4 4" />, <path key="r" d="m16 8 4 4-4 4" />]),
	design: () =>
		svg([
			<circle key="c" cx="12" cy="12" r="8" />,
			<path key="a" d="M12 4a8 8 0 0 1 0 16z" fill="currentColor" stroke="none" />,
		]),
	motion: () => svg(<path d="M9 7v10l8-5z" />),
	content: () => svg(<path d="M4 20 16 8l-4-4L4 16z M14 6l4 4" />),
	data: () =>
		svg([
			<path key="a" d="M5 20V10" />,
			<path key="b" d="M12 20V4" />,
			<path key="c" d="M19 20v-7" />,
		]),
	spatial: () =>
		svg([
			<path key="b" d="M12 3 4 7.5v9L12 21l8-4.5v-9z" />,
			<path key="e" d="M4 7.5 12 12l8-4.5M12 12v9" />,
		]),
	strategy: () => svg([<circle key="c" cx="12" cy="12" r="8" />, <path key="d" d="M12 12 16 8" />]),
	other: () => svg(<circle cx="12" cy="12" r="3.5" fill="currentColor" stroke="none" />),
};

/** Render the glyph for a resolved skill category. */
export function CategoryGlyph({ category }: { category: SkillCategoryId }): VNode {
	return (ICONS[category] ?? ICONS.other)();
}
// #endregion

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
