import { cloneElement, type JSX } from "preact";
import { Avatar } from "@projective/ui/display";
import { Tooltip } from "@projective/ui/feedback";
import { SidebarToggleIcon } from "@web/features/shell/core/nav-icons.tsx";
import { BackIcon, projectViewLinks } from "./detail-glyphs.tsx";
import { PlusIcon } from "./glyphs.tsx";
import { profileHref } from "../core/routing.ts";
import type { ProjectDetail } from "../types/projects-types.ts";

/**
 * ProjectRail — the COLLAPSED presentation of the Project Details sidebar: a single clean vertical
 * icon column shown when the middle-nav lane is dragged/toggled to its narrow rail. It hides every
 * label, channel, header, and description and surfaces only the essential destinations, each an
 * `--shell-nav-block` square matching the global rail's collapsed `.ui-nav-item` (portal
 * {@link Tooltip} carries the name — never a native `title`).
 *
 * Top section (aligned to the top): Back · owner/client avatar (links to `/@handle`) · Details ·
 * Board (dynamic Pipeline/Timeline/Calendar) · Members · Submissions · Attachments · Finances.
 * Bottom section (pinned via `margin-block-start: auto`): a client-only Add-stage ＋ · the Expand
 * toggle (reusing the global rail's {@link SidebarToggleIcon} glyph + morphing-divider slide).
 * Settings is intentionally absent — project settings live in the `/edit` page.
 *
 * Rendered alongside the expanded view; CSS (`.ui-splitter[data-mode="collapsed"]`) reveals exactly
 * one at a time. Its icons are {@link cloneElement}-copied off the shared `projectViewLinks` set so the
 * same glyph VNode is never mounted twice at once (the expanded footer holds the originals).
 */

export interface ProjectRailProps {
	detail: ProjectDetail;
	/** Live pathname — drives the active icon. */
	currentPath: string;
	/** The effective service archetype — sessions drop Submissions + label the Board "Calendar". */
	sessionKind?: "none" | "normal" | "group";
	/** Expand the lane back out (dispatched to the splitter). */
	onExpand: () => void;
	/** Client-only: open the Create New Stage modal. */
	onCreateStage: () => void;
}

export function ProjectRail(
	{ detail, currentPath, sessionKind = "none", onExpand, onCreateStage }: ProjectRailProps,
): JSX.Element {
	const base = `/projects/${detail.slug}`;
	const isSession = sessionKind === "normal" || sessionKind === "group";
	const topLinks = projectViewLinks(detail, sessionKind);
	// A project leads with its owner, a service with its client; fall back to the owner.
	const lead = (detail.kind === "service" ? detail.client : detail.owner) ?? detail.owner;

	const hrefFor = (seg: string) => (seg ? `${base}/${seg}` : base);
	const isActive = (seg: string) =>
		seg ? currentPath === hrefFor(seg) : currentPath === base || currentPath === `${base}/`;

	const link = (key: string, label: string, icon: JSX.Element, seg: string): JSX.Element => (
		<Tooltip key={key} content={label} placement="right">
			<a
				class="proj-railbtn"
				href={hrefFor(seg)}
				data-active={isActive(seg) ? "true" : undefined}
				aria-current={isActive(seg) ? "page" : undefined}
				aria-label={label}
			>
				{cloneElement(icon)}
			</a>
		</Tooltip>
	);

	return (
		<nav class="proj-detail__rail" aria-label="Project navigation">
			<div class="proj-detail__rail-group">
				<Tooltip content="Back" placement="right">
					<a class="proj-railbtn" href="/projects" aria-label="Back to all projects">
						{cloneElement(BackIcon)}
					</a>
				</Tooltip>

				{lead.handle
					? (
						<Tooltip content={lead.name} placement="right">
							<a
								class="proj-railbtn proj-railbtn--avatar"
								href={profileHref(lead.handle)}
								aria-label={`View ${lead.name}'s profile`}
							>
								<Avatar
									image={lead.avatar ?? undefined}
									label={lead.name}
									size={40}
									shape="circle"
								/>
							</a>
						</Tooltip>
					)
					: (
						<Tooltip content={lead.name} placement="right">
							<span class="proj-railbtn proj-railbtn--avatar" aria-label={lead.name}>
								<Avatar
									image={lead.avatar ?? undefined}
									label={lead.name}
									size={40}
									shape="circle"
								/>
							</span>
						</Tooltip>
					)}

				{topLinks.map((l) => link(l.key, l.label, l.icon, l.seg))}
			</div>

			<div class="proj-detail__rail-group proj-detail__rail-group--bottom">
				{detail.viewerIsClient && !isSession && (
					<Tooltip content="Add stage" placement="right">
						<button
							type="button"
							class="proj-railbtn proj-railbtn--add"
							aria-label="Add stage"
							onClick={onCreateStage}
						>
							{cloneElement(PlusIcon)}
						</button>
					</Tooltip>
				)}

				<Tooltip content="Expand lane" placement="right">
					<button
						type="button"
						class="proj-railbtn proj-railbtn--toggle"
						data-collapsed="true"
						aria-label="Expand lane"
						aria-pressed={true}
						onClick={onExpand}
					>
						<SidebarToggleIcon />
					</button>
				</Tooltip>
			</div>
		</nav>
	);
}
