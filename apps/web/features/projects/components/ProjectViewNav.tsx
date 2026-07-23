import type { JSX, RefObject } from "preact";
import { Popover, Tooltip } from "@projective/ui/feedback";
import { SidebarToggleIcon } from "@web/features/shell/core/nav-icons.tsx";
import { projectViewLinks } from "./detail-glyphs.tsx";
import { KebabIcon, PlusIcon } from "./glyphs.tsx";
import type { ProjectDetail } from "../types/projects-types.ts";

/**
 * ProjectViewNav — the compact, minimalist navigation pinned in the sidebar's sticky footer. The
 * footer was streamlined from a crowded seven-icon row into three clear clusters:
 *
 *   - **Left** — the lane Expand/Collapse toggle (reuses the global rail's {@link SidebarToggleIcon}
 *     glyph + its morphing-divider slide, scoped to THIS lane in project-sidebar.css).
 *   - **Centre/Right** — the high-traffic view links as icon-only anchors (Details · Board · Members ·
 *     Submissions), each labelled by a portal {@link Tooltip}; the Board icon/label is DYNAMICALLY
 *     resolved off the engagement format (Pipeline · Timeline · Calendar). Secondary views
 *     (Attachments · Finances) fold into a **More** popover so the row stays uncluttered. Settings is
 *     gone entirely — project settings live in the `/edit` page.
 *   - **Far right** — a distinct **Add stage** action (client-only) that opens the Create New Stage
 *     modal, mirroring the Stages-group ＋ so the action is reachable from the footer too.
 */

/** The primary site sidebar the `top`/`top-end` popovers must never slide under (edge-detection). */
const SHELL_AVOID = [".ui-app-shell__sidebar"] as const;

export interface ProjectViewNavProps {
	detail: ProjectDetail;
	/** Live pathname — drives the active icon. */
	currentPath: string;
	/** Whether the lane is collapsed (drives the toggle glyph + label). */
	collapsed: boolean;
	/** The effective service archetype — sessions drop Submissions + label the Board "Calendar". */
	sessionKind?: "none" | "normal" | "group";
	onToggleCollapse: () => void;
	/** Client-only: open the Create New Stage modal. */
	onCreateStage: () => void;
}

export function ProjectViewNav(
	{ detail, currentPath, collapsed, sessionKind = "none", onToggleCollapse, onCreateStage }:
		ProjectViewNavProps,
): JSX.Element {
	const base = `/projects/${detail.slug}`;
	const isSession = sessionKind === "normal" || sessionKind === "group";
	const links = projectViewLinks(detail, sessionKind);
	const primary = links.filter((l) => !l.overflow);
	const overflow = links.filter((l) => l.overflow);

	const hrefFor = (seg: string) => (seg ? `${base}/${seg}` : base);
	const isActive = (seg: string) =>
		seg ? currentPath === hrefFor(seg) : currentPath === base || currentPath === `${base}/`;
	const overflowActive = overflow.some((l) => isActive(l.seg));

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
				{primary.map((link) => (
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

				{overflow.length > 0 && (
					<Popover
						placement="top-end"
						avoid={SHELL_AVOID}
						allowOverflow={["top"]}
						class="proj-cardmenu-pop"
						trigger={(api) => (
							<Tooltip content="More views" placement="top">
								<button
									type="button"
									ref={api.ref as RefObject<HTMLButtonElement>}
									class="proj-viewnav__btn proj-viewnav__more"
									data-active={overflowActive ? "true" : undefined}
									data-open={api.expanded ? "true" : undefined}
									aria-label="More views"
									aria-haspopup="menu"
									aria-expanded={api.expanded}
									aria-controls={api.panelId}
									onClick={api.toggle}
								>
									<span class="proj-viewnav__icon" aria-hidden="true">{KebabIcon}</span>
								</button>
							</Tooltip>
						)}
					>
						<div class="proj-cardmenu" role="menu" aria-label="More project views">
							{overflow.map((link) => (
								<a
									key={link.key}
									role="menuitem"
									class="proj-cardmenu__item"
									href={hrefFor(link.seg)}
									data-active={isActive(link.seg) ? "true" : undefined}
									aria-current={isActive(link.seg) ? "page" : undefined}
								>
									<span class="proj-cardmenu__icon" aria-hidden="true">{link.icon}</span>
									<span class="proj-cardmenu__label">{link.label}</span>
								</a>
							))}
						</div>
					</Popover>
				)}
			</div>

			{detail.viewerIsClient && !isSession && (
				<Tooltip content="Add stage" placement="top">
					<button
						type="button"
						class="proj-viewnav__add"
						aria-label="Add stage"
						onClick={onCreateStage}
					>
						<span class="proj-viewnav__icon" aria-hidden="true">{PlusIcon}</span>
					</button>
				</Tooltip>
			)}
		</nav>
	);
}
