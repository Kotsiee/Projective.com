import { cloneElement, type JSX } from "preact";
import { Tooltip } from "@projective/ui/feedback";
import { LaneCollapseButton } from "@projective/ui/navigation";
import { SidebarToggleIcon } from "@web/features/shell/core/nav-icons.tsx";
import { BackIcon, DetailsIcon, type ProjectViewLink, viewLinkCurrent } from "./detail-glyphs.tsx";
import { PlusIcon } from "./glyphs.tsx";
import { profileHref } from "../core/routing.ts";
import { isTaskDetail } from "../core/task-project.ts";
import type { ProjectDetail } from "../types/projects-types.ts";
import { UserAvatar } from "@web/components/UserAvatar.tsx";

/**
 * ProjectRail — the COLLAPSED presentation of the Project Details sidebar: a single clean vertical
 * icon column shown when the middle-nav lane is dragged/toggled to its narrow rail. It hides every
 * label, channel, header, and description and surfaces only the essential destinations, each an
 * `--shell-nav-block` square matching the global rail's collapsed `.ui-nav-item` (portal
 * {@link Tooltip} carries the name — never a native `title`).
 *
 * Top section (aligned to the top): Back · owner/client avatar (links to `/@handle`) · the SAME
 * primary views the expanded lane's top tier draws ({@link projectViewLinks} — Overview, Discussion,
 * then the archetype's Board/Timeline/Calendar, Files, Submissions, Members), each carrying its status
 * dot. Bottom section (pinned via `margin-block-start: auto`) — the expanded footer's utilities, in
 * the same order: a client-only Add-stage ＋, the owner's Details (`/details`, Decision #144), and the
 * {@link LaneCollapseButton}, which docks to the lane's corner so the expanded and collapsed toggles
 * share one hitbox.
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
	/** The lane's view links ({@link projectViewLinks}) — the expanded top tier's own set. */
	links: readonly ProjectViewLink[];
	/** Expand the lane back out (dispatched to the splitter). */
	onExpand: () => void;
	/** Client-only: open the Create New Stage modal. */
	onCreateStage: () => void;
}

export function ProjectRail(
	{ detail, currentPath, sessionKind = "none", links: topLinks, onExpand, onCreateStage }:
		ProjectRailProps,
): JSX.Element {
	const base = `/projects/${detail.slug}`;
	const isSession = sessionKind === "normal" || sessionKind === "group";
	// A project leads with its owner, a service with its client; fall back to the owner.
	const lead = (detail.kind === "service" ? detail.client : detail.owner) ?? detail.owner;

	// A Task is held to one stage (`fn_enforce_structure_variation`), so offering it "Add stage" would be
	// a control whose every use the database refuses.
	const canAddStage = detail.viewerIsClient && !isSession && !isTaskDetail(detail);

	const hrefFor = (seg: string) => (seg ? `${base}/${seg}` : base);

	const link = (l: ProjectViewLink): JSX.Element => {
		const current = viewLinkCurrent(currentPath, base, l);
		// The status rides in the tooltip and the name, never as text on the square (§B.6).
		const name = l.status ? `${l.label} — ${l.status.label}` : l.label;
		return (
			<Tooltip key={l.key} content={name} placement="right">
				<a
					class="proj-railbtn"
					href={hrefFor(l.seg)}
					data-active={current ? "true" : undefined}
					aria-current={current ?? undefined}
					aria-label={name}
				>
					{cloneElement(l.icon)}
					{l.status && (
						<span
							class={`proj-railbtn__dot proj-railbtn__dot--${l.status.tone}`}
							aria-hidden="true"
						/>
					)}
				</a>
			</Tooltip>
		);
	};
	const detailsCurrent = viewLinkCurrent(currentPath, base, { seg: "details" });

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
								<UserAvatar
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
								<UserAvatar
									image={lead.avatar ?? undefined}
									label={lead.name}
									size={40}
									shape="circle"
								/>
							</span>
						</Tooltip>
					)}

				{topLinks.map(link)}
			</div>

			<div class="proj-detail__rail-group proj-detail__rail-group--bottom">
				{canAddStage && (
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

				{/* Review authority only — the configuration is nobody else's to open (Decision #144). */}
				{detail.viewerCanConfigure && (
					<Tooltip content="Edit project" placement="right">
						<a
							class="proj-railbtn proj-railbtn--edit"
							href={hrefFor("details")}
							data-active={detailsCurrent ? "true" : undefined}
							aria-current={detailsCurrent ?? undefined}
							aria-label="Edit project"
						>
							{cloneElement(DetailsIcon)}
						</a>
					</Tooltip>
				)}

				<LaneCollapseButton
					collapsed
					icon={<SidebarToggleIcon />}
					tooltipPlacement="right"
					onToggle={onExpand}
				/>
			</div>
		</nav>
	);
}
