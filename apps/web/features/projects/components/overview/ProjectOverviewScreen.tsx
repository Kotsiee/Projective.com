import type { JSX } from "preact";
import "../../styles/project-dashboard.css";
import { isClosedStatus, type ProjectWorkspace } from "@projective/types/projects";
import ProjectPageStyleAnchor from "../../islands/ProjectPageStyleAnchor.island.tsx";
import ProjectNoticeHost from "../../islands/ProjectNoticeHost.island.tsx";
import { profileHref } from "../../core/routing.ts";
import {
	EarningsBlock,
	MessagesBlock,
	MetaFacts,
	StatusMark,
	UpdatesBlock,
	WorkBlock,
} from "../dashboard/DashboardBlocks.tsx";
import { NextActionsBlock, OverviewNotice, PeopleBlock, StageRunBlock } from "./OverviewBlocks.tsx";
import { UserAvatar } from "@web/components/UserAvatar.tsx";

/**
 * The engagement's **Overview** — the body of `/projects/[slug]` for the owner and every participant
 * (Decision #144, which replaced the owner's setup form and the member dashboard at this address).
 *
 * It answers the question a command center exists for: what needs me, and where does everything
 * stand. Two columns from `55rem` of container width, one below it, in this reading order:
 *
 *   • **Main** — Needs you · the stage run · Recent updates.
 *   • **Aside** — Your work and Your earnings (a participant's own position) · Messages · People.
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
}

/** The Overview for one engagement, or a calm miss with the one route back. */
export function ProjectOverviewScreen(
	{ workspace, slug }: ProjectOverviewScreenProps,
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

	const { hero, viewer, nextActions, stages, updates, channels, assignments, finance, people } =
		workspace;
	const participant = viewer === "participant";
	const hasRun = stages.length > 0;

	return (
		<div class="pjd" data-viewer={viewer}>
			<ProjectPageStyleAnchor />
			{/* Turns a `?notice=room-not-found` left by the room guard into one toast, then strips it. */}
			<ProjectNoticeHost />
			<div class="pjd__inner">
				<header class="pjd-hero">
					<div class="pjd-hero__identity">
						<UserAvatar
							image={hero.owner.avatar ?? undefined}
							label={hero.owner.name}
							size="md"
						/>
						{
							/*
							 * The owner's handle resolves to the canonical wildcard namespace `/@handle`
							 * (Decision #3). A party with no public handle has no profile to reach, so the
							 * name renders as text rather than as a link that would 404 (§3 gate 11).
							 */
						}
						{hero.handle
							? (
								<a class="pjd-hero__owner" href={profileHref(hero.handle)}>
									<span class="pjd-hero__owner-name">{hero.owner.name}</span>
									<span class="pjd-hero__handle">
										@{hero.handle.replace(/^@/, "")}
									</span>
								</a>
							)
							: (
								<span class="pjd-hero__owner-static">
									<span class="pjd-hero__owner-name">{hero.owner.name}</span>
								</span>
							)}
					</div>

					<h1 class="pjd-hero__title">{hero.title}</h1>

					<div class="pjd-hero__facts">
						<StatusMark status={hero.status} label={hero.statusLabel} />
						<MetaFacts items={hero.meta} />
					</div>

					<OverviewNotice status={hero.status} viewer={viewer} slug={slug} />
				</header>

				<div class="pjd__layout">
					<div class="pjd__main">
						<NextActionsBlock actions={nextActions} closed={isClosedStatus(hero.status)} />
						{hasRun && <StageRunBlock stages={stages} viewer={viewer} />}
						<UpdatesBlock updates={updates} />
					</div>
					<div class="pjd__aside">
						{participant && (
							<WorkBlock
								assignments={assignments}
								// The run already states stage progress; the meter would say it twice.
								completedStages={hasRun ? null : hero.completedStages}
								totalStages={hasRun ? null : hero.totalStages}
							/>
						)}
						{participant && <EarningsBlock finance={finance} />}
						<MessagesBlock channels={channels} />
						{people && <PeopleBlock people={people} slug={slug} viewer={viewer} />}
					</div>
				</div>
			</div>
		</div>
	);
}
