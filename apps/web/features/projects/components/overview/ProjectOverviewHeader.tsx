import type { JSX } from "preact";
import { Icon } from "@projective/ui/icons";
import { projectDetailsHref, projectHref } from "../../core/project-access.ts";

/**
 * The Overview's middle-nav HEADER band (Decision #144): the engagement's name, and — for the owner —
 * the way to its configuration and preview.
 *
 * The lifecycle status is NOT repeated here. The page's hero already carries it as the surface's one
 * filled mark (DESIGN_SYSTEM §B.11, the dashboard sheet's own rule), and two identical pills one band
 * apart are one fact said twice.
 *
 * Details and Preview are plain links, not the Details ⇄ Preview tab pair `/details` carries: the
 * Overview is not one of those two modes, so drawing it as a tab strip would mark neither as current
 * and imply the page is a third tab of a configuration it is not part of. Preview is drawn only when
 * the engagement may preview (`previewAllowed`); a locked control that does nothing is worse than its
 * absence (root CLAUDE.md §3 gate 11), and `/details` already says what is missing.
 *
 * Star stays in the lane header, where it already lives: an action gets one home.
 *
 * A server component (links only). Its styles ride the page's style anchor, which every route that
 * mounts this band also mounts.
 */
export interface ProjectOverviewHeaderProps {
	slug: string;
	title: string;
	/** Whether the viewer owns the engagement — only they configure and preview it. */
	owner: boolean;
	/** Whether Preview is open to the owner right now. */
	canPreview: boolean;
}

export function ProjectOverviewHeader(props: ProjectOverviewHeaderProps): JSX.Element {
	const { slug, title, owner, canPreview } = props;
	return (
		<header class="pjd-head">
			<div class="pjd-head__id">
				<span class="pjd-head__title">{title || "Untitled project"}</span>
			</div>
			{owner && (
				<nav class="pjd-head__links" aria-label="Project configuration">
					<a class="pjd-head__link" href={projectDetailsHref(slug)}>
						<span class="pjd-head__icon" aria-hidden="true">
							<Icon name="edit" size="sm" />
						</span>
						<span>Details</span>
					</a>
					{canPreview && (
						<a class="pjd-head__link" href={projectHref(slug, "preview")}>
							<span class="pjd-head__icon" aria-hidden="true">
								<Icon name="eye" size="sm" />
							</span>
							<span>Preview</span>
						</a>
					)}
				</nav>
			)}
		</header>
	);
}
