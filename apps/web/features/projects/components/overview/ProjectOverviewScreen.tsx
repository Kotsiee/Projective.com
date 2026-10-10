import type { JSX } from "preact";
import "../../styles/project-dashboard.css";
import {
	isClosedStatus,
	type FileListPage,
	type OverviewChange,
	type ProjectWorkspace,
} from "@projective/types/projects";
import ProjectPageStyleAnchor from "../../islands/ProjectPageStyleAnchor.island.tsx";
import ProjectNoticeHost from "../../islands/ProjectNoticeHost.island.tsx";
import OverviewArrival from "../../islands/OverviewArrival.island.tsx";
import ProjectAttachments from "../../islands/ProjectAttachments.island.tsx";
import {
	Block,
	EarningsBlock,
	MessagesBlock,
	MetaFacts,
	StatusMark,
	UpdatesBlock,
	WorkBlock,
} from "../dashboard/DashboardBlocks.tsx";
import { NextActionsBlock, OverviewNotice, PeopleBlock, StageRunBlock } from "./OverviewBlocks.tsx";
import { BriefBlock, TermsBlock } from "./BriefBlocks.tsx";
import { ClaimableBlock, SubmissionsBlock } from "./WorkSignalBlocks.tsx";

/**
 * The engagement's **Overview** — the body of `/projects/[slug]` for the owner and every participant
 * (Decision #144, which replaced the owner's setup form and the member dashboard at this address).
 *
 * It answers the question a command center exists for: what needs me, and where does everything
 * stand. Two columns from `55rem` of container width, one below it, in this reading order:
 *
 *   • **Main** — Needs you · the Brief · Inclusions & terms · Project files · the stage run · Recent
 *     updates.
 *   • **Aside** — a participant's Active submissions, Claimable tasks, Your work and Your earnings ·
 *     Messages (only when there is more than the one Discussion the lane already links) · People.
 *
 * The owner is not shown a money block: the live overview's finance is a neutral placeholder (all
 * zeros), and "$0 in escrow" on a funded engagement would be a false statement, not a missing one.
 * Their figures — each stage's price — sit on the stage run, where they are true.
 *
 * ## Whitespace is the separation device
 *
 * Blocks are separated by the grid's gap alone — no cards, no panels, no borders around static
 * content (DESIGN_SYSTEM §B.4, §B.9). Inside a block one hairline separates one row from the next. The
 * only container on the surface is the lifecycle status, which is a state that can change (§B.11).
 * Commands live in the bands (the Overview header and rig), so the canvas holds no buttons.
 *
 * ## Everything it renders was resolved on the server
 *
 * A server component with no state and no fetch: the composition, every href and every figure arrive
 * resolved (`ProjectBackendService.workspace`). Money is `MoneyView` all the way down (Decision #55).
 *
 * ⚠️ **The stylesheet needs an island carrier on whatever route mounts this.** Vite collects CSS
 * side-effect imports from the ISLAND graph only, so {@link ProjectPageStyleAnchor} is mounted on both
 * branches — the miss as well as the page.
 */

/** Props for {@link ProjectOverviewScreen}. */
export interface ProjectOverviewScreenProps {
	/** The composed Overview read, or `null` on a miss. */
	workspace: ProjectWorkspace | null;
	/** The routed slug — quoted in the not-found branch so the reader can see what was asked for. */
	slug: string;
	/** Regions changed since the viewer's last visit — highlighted briefly on arrival. */
	changes?: readonly OverviewChange[];
	/** The client's project files, or `null` when that read failed. */
	attachments?: FileListPage | null;
}

/** The Overview for one engagement, or a calm miss with the one route back. */
export function ProjectOverviewScreen(
	{ workspace, slug, changes = [], attachments = null }: ProjectOverviewScreenProps,
): JSX.Element {
	if (!workspace) {
		return (
			<div class="pjd">
				<ProjectPageStyleAnchor />
				<div class="pjd__inner">
					<div class="pjd-miss">
						<h1 class="pjd-miss__title">Project not found</h1>
						<p class="pjd-miss__note">
							“{slug}” doesn’t match any engagement you can access.
						</p>
						<a class="pjd-miss__cta" href="/projects">Back to all projects</a>
					</div>
				</div>
			</div>
		);
	}

	const {
		hero,
		viewer,
		nextActions,
		stages,
		updates,
		channels,
		assignments,
		finance,
		people,
		brief,
		roster,
		submissions,
		claimable,
	} = workspace;
	const participant = viewer === "participant";
	const hasRun = stages.length > 0;
	// The lane already links the Discussion; a list holding that one room restates it.
	const showMessages = channels.length > 1;

	return (
		<div class="pjd" data-viewer={viewer}>
			<ProjectPageStyleAnchor />
			{/* Turns a `?notice=room-not-found` left by the room guard into one toast, then strips it. */}
			<ProjectNoticeHost />
			{changes.length > 0 && <OverviewArrival changes={changes} />}
			<div class="pjd__inner">
				<header class="pjd-hero">
					<h1 class="pjd-hero__title" data-pjd-region="details">{hero.title}</h1>

					<div class="pjd-hero__facts" data-pjd-region="status">
						<StatusMark status={hero.status} label={hero.statusLabel} />
						<MetaFacts items={hero.meta} />
					</div>

					<OverviewNotice status={hero.status} viewer={viewer} slug={slug} />
				</header>

				<div class="pjd__layout">
					<div class="pjd__main">
						<NextActionsBlock actions={nextActions} closed={isClosedStatus(hero.status)} />
						{brief && <BriefBlock brief={brief} />}
						{brief && <TermsBlock brief={brief} />}
						<Block title="Project files">
							<ProjectAttachments projectSlug={slug} initial={attachments} />
						</Block>
						{hasRun && <StageRunBlock stages={stages} viewer={viewer} />}
						<UpdatesBlock updates={updates} />
					</div>
					<div class="pjd__aside">
						{participant && <SubmissionsBlock submissions={submissions} slug={slug} />}
						{participant && <ClaimableBlock claimable={claimable} />}
						{participant && (
							<WorkBlock
								assignments={assignments}
								// The run already states stage progress; the meter would say it twice.
								completedStages={hasRun ? null : hero.completedStages}
								totalStages={hasRun ? null : hero.totalStages}
							/>
						)}
						{participant && <EarningsBlock finance={finance} />}
						{showMessages && <MessagesBlock channels={channels} />}
						{people && (
							<PeopleBlock people={people} roster={roster} slug={slug} viewer={viewer} />
						)}
					</div>
				</div>
			</div>
		</div>
	);
}
