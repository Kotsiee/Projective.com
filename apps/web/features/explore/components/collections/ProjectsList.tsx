import type { JSX } from "preact";
import { ProjectRow } from "../cards/ProjectRow.tsx";
import type { ProjectItem } from "../../types/explore-types.ts";

/**
 * ProjectsList — projects displayed as a scannable structured list (NOT a grid): projects never carry
 * item media, so a text-forward vertical list of {@link ProjectRow}s reads best. Semantic `<ul>` /
 * `<li>` for assistive tech; zero client JS.
 */
export function ProjectsList(
	{ items, authed = false }: { items: ProjectItem[]; authed?: boolean },
): JSX.Element {
	return (
		<ul class="ex-list" role="list" aria-label="Open projects">
			{items.map((p) => (
				<li class="ex-list__item" key={p.id}>
					<ProjectRow item={p} authed={authed} />
				</li>
			))}
		</ul>
	);
}
