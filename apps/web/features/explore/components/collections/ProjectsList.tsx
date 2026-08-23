import type { JSX } from "preact";
import { ProjectCard } from "../cards/ProjectCard.tsx";
import type { ProjectItem } from "../../types/explore-types.ts";

/**
 * ProjectsList — open projects as a fixed TWO-COLUMN grid of {@link ProjectCard}s.
 *
 * Two columns, always: never auto-fit, never a single gapless column. A project card is a bounded
 * brief — a header, a title, a stage pipeline, three lines of summary, a skill row — so its height is
 * predictable and two equal columns pack it without the ragged bottom edge an auto-fit track produces
 * when the last row is short. It is also the layout that stops projects reading as a ranked list: a
 * full-width row implies an order that an open call does not have.
 *
 * The `ex-list` naming is kept off deliberately — this is no longer a list presentation, and the class
 * still carries the divider-row rules the card replaced.
 *
 * Semantic `<ul>` / `<li>` for assistive tech; zero client JS.
 */
export function ProjectsList(
	{ items, authed = false }: { items: ProjectItem[]; authed?: boolean },
): JSX.Element {
	return (
		<ul class="ex-projgrid" role="list" aria-label="Open projects">
			{items.map((p) => (
				<li class="ex-projgrid__cell" key={p.id}>
					<ProjectCard item={p} authed={authed} />
				</li>
			))}
		</ul>
	);
}
