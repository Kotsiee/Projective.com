import type { JSX } from "preact";
import { Tooltip } from "@projective/ui/feedback";
import { SidebarToggleIcon } from "@web/features/shell/core/nav-icons.tsx";
import { projectViewLinks } from "./detail-glyphs.tsx";
import type { ProjectDetail } from "../types/projects-types.ts";

/**
 * ProjectViewNav — the compact, icon-ONLY horizontal navigation pinned in the sidebar's sticky
 * footer. Each project view (Details · Board · Members · Attachments · Submissions · Finances ·
 * Settings) is a single icon anchor whose destination is revealed on hover through the portal-based
 * `@projective/ui` {@link Tooltip} — no persistent labels. The Board icon + tooltip are DYNAMICALLY
 * labelled off the engagement format/kind (Pipeline · Timeline · Calendar).
 *
 * Footer layout: the lane Expand/Collapse toggle is pinned to the LEFT and the view links group flush
 * to the RIGHT. The toggle reuses the global rail's {@link SidebarToggleIcon} glyph AND its
 * morphing-divider slide animation (the dotted bar tracks THIS lane's collapsed state, scoped in
 * project-sidebar.css) so it reads identically to `ui-shell-sidebar__toggle`.
 */

export interface ProjectViewNavProps {
	detail: ProjectDetail;
	/** Live pathname — drives the active icon. */
	currentPath: string;
	/** Whether the lane is collapsed (drives the toggle glyph + label). */
	collapsed: boolean;
	onToggleCollapse: () => void;
}

export function ProjectViewNav(
	{ detail, currentPath, collapsed, onToggleCollapse }: ProjectViewNavProps,
): JSX.Element {
	const base = `/projects/${detail.slug}`;
	const links = projectViewLinks(detail);

	const hrefFor = (seg: string) => (seg ? `${base}/${seg}` : base);
	const isActive = (seg: string) =>
		seg ? currentPath === hrefFor(seg) : currentPath === base || currentPath === `${base}/`;

	return (
		<nav class="proj-viewnav" aria-label="Project views">
			<Tooltip content={collapsed ? "Expand lane" : "Collapse lane"} placement="top">
				<button
					type="button"
					class="proj-viewnav__collapse"
					data-collapsed={collapsed ? "true" : undefined}
					aria-label={collapsed ? "Expand lane" : "Collapse lane"}
					aria-pressed={collapsed}
					onClick={onToggleCollapse}
				>
					<SidebarToggleIcon />
				</button>
			</Tooltip>

			<div class="proj-viewnav__links">
				{links.map((link) => (
					<Tooltip key={link.key} content={link.label} placement="top">
						<a
							class="proj-viewnav__btn"
							href={hrefFor(link.seg)}
							data-active={isActive(link.seg) ? "true" : undefined}
							aria-current={isActive(link.seg) ? "page" : undefined}
							aria-label={link.label}
						>
							<span class="proj-viewnav__icon" aria-hidden="true">{link.icon}</span>
						</a>
					</Tooltip>
				))}
			</div>
		</nav>
	);
}
