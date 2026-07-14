import type { SkillCategoryId, SkillRef } from "@projective/types/explore";

/**
 * Skill → visual-category resolver (server side).
 *
 * The pure half of the app's `skill-map` — a stub taxonomy mapping a free-text skill tag to one of a
 * small set of visual categories, used to build the discovery fixtures. The app keeps the matching
 * glyphs/labels for rendering; this copy stays server-side so the fat service (which the app cannot
 * import from) can construct `SkillRef`s. Swap for the taxonomy API when it lands.
 */

/**
 * Keyword → category lookup. Matched case-insensitively as a substring, so "Design systems", "System
 * design", and "design" all resolve to `design`. First hit wins.
 */
const KEYWORDS: Array<[string, SkillCategoryId]> = [
	["javascript", "technical"],
	["typescript", "technical"],
	["deno", "technical"],
	["preact", "technical"],
	["react", "technical"],
	["node", "technical"],
	["postgres", "technical"],
	["backend", "technical"],
	["frontend", "technical"],
	["realtime", "technical"],
	["signals", "technical"],
	["a11y", "technical"],
	["devops", "technical"],
	["figma", "design"],
	["design system", "design"],
	["design", "design"],
	["ux", "design"],
	["ui", "design"],
	["brand", "design"],
	["identity", "design"],
	["illustration", "design"],
	["icon", "design"],
	["motion", "motion"],
	["animation", "motion"],
	["video", "motion"],
	["film", "motion"],
	["after effects", "motion"],
	["copy", "content"],
	["content", "content"],
	["writing", "content"],
	["seo", "content"],
	["editorial", "content"],
	["strategy", "strategy"],
	["ops", "strategy"],
	["product", "strategy"],
	["data", "data"],
	["analytics", "data"],
	["dashboard", "data"],
	["webgl", "spatial"],
	["blender", "spatial"],
	["three.js", "spatial"],
	["3d", "spatial"],
	["spatial", "spatial"],
];

/** Resolve a raw skill tag to its visual category (falls back to `other`). */
export function skillCategory(label: string): SkillCategoryId {
	const l = label.toLowerCase();
	for (const [needle, cat] of KEYWORDS) {
		if (l.includes(needle)) return cat;
	}
	return "other";
}

/** Build a {@link SkillRef} (label + resolved category) from a raw tag. */
export function resolveSkill(label: string): SkillRef {
	return { label, category: skillCategory(label) };
}

/** Convenience: resolve an array of raw tags. */
export function resolveSkills(labels: string[]): SkillRef[] {
	return labels.map(resolveSkill);
}
