import type { JSX } from "preact";
import { Avatar } from "@projective/ui/display";
import "../../styles/project-dashboard.css";
import ProjectPageStyleAnchor from "../../islands/ProjectPageStyleAnchor.island.tsx";
import type { ProjectOverview } from "../../types/projects-types.ts";
import { profileHref } from "../../core/routing.ts";
import {
	EarningsBlock,
	MessagesBlock,
	MetaFacts,
	StatusMark,
	UpdatesBlock,
	WorkBlock,
} from "./DashboardBlocks.tsx";

/**
 * The member dashboard body of `/projects/[projectId]` — the half of that route a viewer who is NOT
 * the client sees.
 *
 * The route is a role dispatcher. An owner gets the setup surface, which asks "is this engagement
 * ready to hire against"; everybody else gets this, which asks "what does this engagement want from
 * ME". They are separate reads for the same reason they are separate surfaces — one projection
 * serving both would hand a freelancer the owner's budget fields and hand the owner an assignment
 * list that is always empty.
 *
 * ## Whitespace is the separation device
 *
 * The four blocks sit in a grid whose `gap` is the whole boundary between them: no cards, no panels,
 * no borders around static content (DESIGN_SYSTEM.md §B.4). Inside a block, one hairline separates
 * one row from the next and nothing else does. The single container on the surface is the lifecycle
 * status in the hero, which is a state that can change — the §B.11 test that separates a status from
 * a category, and the reason the type/format/workspace facts beside it are inline middot text.
 *
 * ## Everything it renders was resolved on the server
 *
 * A server component with no state and no fetch. Money is `MoneyView` all the way down, so a currency
 * switch re-projects each figure from its own origin and the client never totals, splits or converts
 * anything (root CLAUDE.md §8 Decision #55). The stage meter's geometry is written directly rather
 * than transitioned into place, because a backgrounded tab freezes the animation clock and a meter
 * that arrives through a transition reports 0% on an engagement that has progress.
 *
 * ⚠️ **The stylesheet needs an island carrier on whatever route mounts this.** Vite collects CSS
 * side-effect imports from the ISLAND graph, never from the SSR render, so the import below reaches a
 * page only once an island on the route imports this module or the sheet itself — the
 * `ShowcaseStyleAnchor` pattern. It is declared here regardless: the dependency belongs where the
 * markup is, and the bundler dedupes it.
 */

/** Props for {@link ProjectMemberDashboard}. */
export interface ProjectMemberDashboardProps {
	/** The dashboard projection resolved by `resolveProjectOverview`, or `null` on a miss. */
	overview: ProjectOverview | null;
	/** The routed slug — quoted in the not-found branch so the reader can see what was asked for. */
	slug: string;
}

/**
 * The member dashboard for one engagement: an identity hero over Recent updates, Messages, Your work
 * and Your earnings. A slug that resolved to nothing renders a calm miss with the one route back.
 */
export function ProjectMemberDashboard(
	{ overview, slug }: ProjectMemberDashboardProps,
): JSX.Element {
	if (!overview) {
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

	const { hero, updates, channels, assignments, finance } = overview;

	return (
		<div class="pjd">
			{/*
			 * On BOTH branches, not just the miss. This is a server component, and the Vite build
			 * collects CSS side-effect imports from the ISLAND graph only — so with the anchor mounted
			 * on the not-found path alone, the "Project not found" state shipped styled while the real
			 * dashboard shipped 176 `pjd-*` elements with no rules at all. Invisible in dev, where Vite
			 * serves a `<link>` from the SSR graph on both.
			 */}
			<ProjectPageStyleAnchor />
			<div class="pjd__inner">
				<header class="pjd-hero">
					<div class="pjd-hero__identity">
						<Avatar
							image={hero.owner.avatar ?? undefined}
							label={hero.owner.name}
							size="md"
						/>
						{
							/*
							 * The owner's handle resolves to the canonical wildcard namespace `/@handle`
							 * (Decision #3), never `/profile/…`. A party with no public handle has no
							 * profile to reach, so the name renders as text rather than as a link that
							 * would 404 — an affordance that reaches nothing is §3 gate 11.
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
				</header>

				<div class="pjd__grid">
					<UpdatesBlock updates={updates} />
					<MessagesBlock channels={channels} />
					<WorkBlock
						assignments={assignments}
						completedStages={hero.completedStages}
						totalStages={hero.totalStages}
					/>
					<EarningsBlock finance={finance} />
				</div>
			</div>
		</div>
	);
}
