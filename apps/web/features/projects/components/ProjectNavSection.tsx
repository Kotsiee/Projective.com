import type { JSX } from "preact";
import { NavItem } from "@projective/ui/navigation";
import { type ProjectViewLink, viewLinkCurrent } from "./detail-glyphs.tsx";

/**
 * ProjectNavSection — the lane's top tier: the engagement's primary views as full `NavItem` rows
 * (icon + label), directly beneath the project header.
 *
 * These were a row of icon-only buttons in the footer, folding into a kebab as the lane narrowed — the
 * views a reader moves between most, ranked below a collapse toggle and hidden by a fit algorithm.
 * They are the lane's first destinations now, named in words, and the footer keeps only utilities.
 *
 * The set is {@link projectViewLinks} — archetype-specific (a Task has no Board or Timeline, a session
 * has a Calendar and no Submissions) and shared with the collapsed rail. A link's status is a trailing
 * dot (§D.1 — never a count) whose meaning is folded into the link's accessible name.
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
					<li key={link.key} class="proj-nav__item">
						<NavItem
							href={link.seg ? `${base}/${link.seg}` : base}
							label={link.label}
							icon={link.icon}
							active={viewLinkCurrent(currentPath, base, link) ?? false}
							dot={link.status !== null}
							dotLabel={link.status?.label}
							trailing={link.status ? <span class="proj-nav__dot" /> : undefined}
						/>
					</li>
				))}
			</ul>
		</nav>
	);
}
