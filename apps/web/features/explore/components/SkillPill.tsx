import { Fragment, type JSX } from "preact";
import { SKILL_CATEGORY_LABEL } from "../core/skill-map.tsx";
import { filterHref } from "../core/routing.ts";
import type { SkillRef } from "../types/explore-types.ts";

/**
 * SkillPill — one skill as an inline text link (no box, no glyph: §B.11, Decision #349). It is a real
 * anchor into Explore's search state (`/explore?q=<skill>`), so clicking one runs a filter search
 * instantly (and, from the Home layout, flips into Search Results) while middle-click / ⌘-click still
 * open a new tab. Inside a card it sits above the stretched link, so it stays clickable without
 * nesting anchors (invalid HTML). Its category rides in the accessible name.
 */
export function SkillPill({ skill }: { skill: SkillRef }): JSX.Element {
	return (
		<a
			class="ex-pill"
			href={filterHref({ q: skill.label })}
			data-stop
			aria-label={`Filter by ${skill.label} (${SKILL_CATEGORY_LABEL[skill.category]})`}
		>
			{skill.label}
		</a>
	);
}

/** The skills as one middot-joined line of links, capped (the rest counted as a muted `+N`). */
export function SkillPills(
	{ skills, max = 3 }: { skills: SkillRef[]; max?: number },
): JSX.Element {
	const shown = skills.slice(0, max);
	const extra = skills.length - shown.length;
	return (
		<p class="ex-pills">
			{shown.map((s, i) => (
				<Fragment key={s.label}>
					{i > 0 && <span class="ex-pills__sep" aria-hidden="true">·</span>}
					<SkillPill skill={s} />
				</Fragment>
			))}
			{extra > 0 && <span class="ex-pills__more">+{extra}</span>}
		</p>
	);
}
