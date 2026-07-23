import type { JSX } from "preact";
import { Avatar } from "@projective/ui/display";
import { Empty } from "./tab-shared.tsx";
import type { EducationEntry } from "../../types/profile-types.ts";

/**
 * EducationTab — a structured timeline of education entries (credential · field · school · dates),
 * each with the institution's square logo (root CLAUDE.md Part 2).
 */
export function EducationTab({ entries }: { entries: EducationEntry[] }): JSX.Element {
	if (!entries.length) return <Empty note="No education listed yet." />;
	return (
		<ul class="pf-timeline" role="list">
			{entries.map((e) => (
				<li class="pf-tl" key={e.id}>
					<Avatar image={e.logo} label={e.school} size="md" shape="square" class="pf-tl__logo" />
					<div class="pf-tl__body">
						<span class="pf-tl__title">{e.credential} · {e.field}</span>
						<span class="pf-tl__org">{e.school}</span>
						<span class="pf-tl__dates">{e.start} – {e.end ?? "Present"}</span>
					</div>
				</li>
			))}
		</ul>
	);
}
