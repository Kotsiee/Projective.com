/**
 * skill-match — which `org.skills` labels a typed query offers in the workspace's skills field.
 * Pure, so the ranking is tested without the taxonomy read.
 */

/** The most skills one typeahead answer offers. */
export const SKILL_MATCH_LIMIT = 12;

function rank(label: string, q: string): number {
	const lower = label.toLowerCase();
	if (lower.startsWith(q)) return 0;
	if (lower.split(/[\s/&-]+/).some((word) => word.startsWith(q))) return 1;
	return lower.includes(q) ? 2 : -1;
}

/**
 * The labels matching `query`: those that start with it first, then those with a word that does,
 * then any that contain it, alphabetical within each group. An empty query matches nothing, because
 * a typeahead with nothing typed has nothing to narrow.
 */
export function matchSkillLabels(
	labels: readonly string[],
	query: string,
	limit = SKILL_MATCH_LIMIT,
): string[] {
	const q = query.trim().toLowerCase();
	if (!q) return [];
	return labels
		.map((label) => ({ label, rank: rank(label, q) }))
		.filter((m) => m.rank >= 0)
		.sort((a, b) => a.rank - b.rank || a.label.localeCompare(b.label))
		.slice(0, limit)
		.map((m) => m.label);
}
