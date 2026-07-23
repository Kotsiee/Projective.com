import type { JSX } from "preact";
import { Avatar } from "@projective/ui/display";
import { Empty } from "./tab-shared.tsx";
import type { ExperienceEntry } from "../../types/profile-types.ts";

/**
 * ExperienceTab — a structured timeline of work experience (role · organisation · dates · summary),
 * each with the organisation's square logo (root CLAUDE.md Part 2).
 */
export function ExperienceTab({ entries }: { entries: ExperienceEntry[] }): JSX.Element {
	if (!entries.length) return <Empty note="No experience listed yet." />;
	return (
		<ul class="pf-timeline" role="list">
			{entries.map((e) => (
				<li class="pf-tl" key={e.id}>
					<Avatar image={e.logo} label={e.org} size="md" shape="square" class="pf-tl__logo" />
					<div class="pf-tl__body">
						<span class="pf-tl__title">{e.role}</span>
						<span class="pf-tl__org">{e.org}</span>
						<span class="pf-tl__dates">
							{e.start} – {e.current ? "Present" : e.end ?? "Present"}
						</span>
						<p class="pf-tl__summary">{e.summary}</p>
					</div>
				</li>
			))}
		</ul>
	);
}
