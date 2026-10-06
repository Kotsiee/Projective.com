import type { JSX } from "preact";
import { NavItem } from "@projective/ui/navigation";
import { type ProjectViewLink, viewLinkCurrent } from "./detail-glyphs.tsx";
import type { ProjectViewStatus } from "../core/nav-activity-model.ts";

/**
 * ProjectNavSection — the lane's top tier: the engagement's primary views as full `NavItem` rows
 * (icon + label), directly beneath the project header.
 *
 * These were a row of icon-only buttons in the footer, folding into a kebab as the lane narrowed — the
 * views a reader moves between most, ranked below a collapse toggle and hidden by a fit algorithm.
 * They are the lane's first destinations now, named in words, and the footer keeps only utilities.
 *
 * The set is {@link projectViewLinks} — archetype-specific (a Task has no Board or Timeline, a session
 * has a Calendar and no Submissions) and shared with the collapsed rail. A link's activity mark sits
 * at the row's end: a toned dot, or a plain tabular figure where the number is what the reader acts on
 * (Decision #146). Its meaning is folded into the link's accessible name.
 *
 * Current-place marking is {@link viewLinkCurrent}: `aria-current="page"` on the view itself, `"true"`
 * on a page beneath a section link (the Discussion's Files tab is still the Discussion).
 */
export interface ProjectNavSectionProps {
	links: readonly ProjectViewLink[];
	/** `/projects/{slug}` — the links resolve against it. */
	base: string;
	/** Live pathname — drives the current link. */
	currentPath: string;
}

export function ProjectNavSection(
	{ links, base, currentPath }: ProjectNavSectionProps,
): JSX.Element {
	return (
		<nav class="proj-nav" aria-label="Project views">
			<ul class="proj-nav__list" role="list">
				{links.map((link) => (
					<li key={link.key} class="proj-nav__item" data-nav-view={link.key}>
						<NavItem
							href={link.seg ? `${base}/${link.seg}` : base}
							label={link.label}
							icon={link.icon}
							active={viewLinkCurrent(currentPath, base, link) ?? false}
							dot={link.status !== null}
							dotLabel={link.status?.label}
							trailing={link.status ? <NavMark status={link.status} /> : undefined}
						/>
					</li>
				))}
			</ul>
		</nav>
	);
}

function NavMark({ status }: { status: ProjectViewStatus }): JSX.Element {
	if (status.count !== null) return <span class="proj-nav__count">{status.count}</span>;
	return <span class={`proj-nav__dot proj-nav__dot--${status.tone}`} />;
}
