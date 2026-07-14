import type { JSX } from "preact";
import { CategoryGlyph, SKILL_CATEGORY_LABEL } from "../core/skill-map.tsx";
import { filterHref } from "../core/routing.ts";
import type { SkillRef } from "../types/explore-types.ts";

/**
 * SkillPill — an independently-clickable skill sub-badge carrying its category glyph (e.g. `</>` for
 * technical work). It is a real anchor into Explore's search state (`/explore?q=<skill>`), so clicking
 * one runs a filter search instantly (and, from the Home layout, flips into Search Results) while
 * middle-click / ⌘-click still open a new tab. Inside a card it sits above the stretched link, so it
 * stays clickable without nesting anchors (invalid HTML).
 */
export function SkillPill({ skill }: { skill: SkillRef }): JSX.Element {
	return (
		<a
			class="ex-pill"
			href={filterHref({ q: skill.label })}
			data-stop
			aria-label={`Filter by ${skill.label} (${SKILL_CATEGORY_LABEL[skill.category]})`}
		>
			<span class="ex-pill__icon" aria-hidden="true">
				<CategoryGlyph category={skill.category} />
			</span>
			<span class="ex-pill__label">{skill.label}</span>
		</a>
	);
}

/** A row of skill pills, capped so cards stay tidy (extra count shown as a muted `+N`). */
export function SkillPills(
	{ skills, max = 3 }: { skills: SkillRef[]; max?: number },
): JSX.Element {
	const shown = skills.slice(0, max);
	const extra = skills.length - shown.length;
	return (
		<div class="ex-pills">
			{shown.map((s) => <SkillPill key={s.label} skill={s} />)}
			{extra > 0 && <span class="ex-pills__more">+{extra}</span>}
		</div>
	);
}
