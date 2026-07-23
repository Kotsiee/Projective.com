import type { JSX } from "preact";
import ProjectViewHeader from "@features/view/islands/ProjectViewHeader.island.tsx";
import { ProjectShowcaseBody } from "@features/view/components/ProjectShowcaseBody.tsx";
import ShowcaseStyleAnchor from "../islands/ShowcaseStyleAnchor.island.tsx";
import type { ProjectShowcase } from "../core/showcase-model.ts";

/**
 * ProjectShowcaseScreen — the main body of `/projects/[projectId]` (the Project **Preview**). Per the
 * brief §Part 1.1 the Preview "displays the project exactly as freelancers see it, using the
 * `/view/[id]?type=projects` presentation" — so the body is deliberately ROLE-AGNOSTIC: it renders the
 * freelancer-facing showcase (Apply CTA + calm "not specified yet" placeholders) for BOTH the owner and a
 * freelancer, reusing the view feature's {@link ProjectViewHeader} (banner/avatar chrome + scroll-migration
 * probe) and the shared {@link ProjectShowcaseBody} (About · classification-tailored details · required
 * roles · interactive stage flow). A change to that showcase therefore propagates to both surfaces
 * automatically (root brief §Implementation Guidelines).
 *
 * The client's differentiation lives entirely in the middle-nav HEADER band (the Preview↔Edit switch,
 * resolved separately by `projectHeaderFor`) and the untouched Project Details sidebar lane — never in
 * this body. Unpopulated rich fields the projects read model doesn't carry (stage descriptions, roles,
 * seats, pricing) degrade to graceful placeholders (§"Handling Incomplete Data"). A resolved-to-nothing
 * slug renders a calm not-found with a way back to the feed.
 */
export interface ProjectShowcaseScreenProps {
	/** The showcase projection resolved by `resolveProjectShowcase`, or `null` on a miss. */
	showcase: ProjectShowcase | null;
	/** The routed slug (the not-found back link). */
	slug: string;
}

export function ProjectShowcaseScreen(
	{ showcase, slug }: ProjectShowcaseScreenProps,
): JSX.Element {
	if (!showcase) {
		return (
			<div class="vw vw-project">
				<ShowcaseStyleAnchor />
				<div class="vw__back-row">
					<a class="vw__back" href="/projects">← All projects</a>
				</div>
				<div class="vw-project__missing">
					<h1 class="vw-project__missing-title">Project not found</h1>
					<p class="vw-project__missing-note">
						“{slug}” doesn’t match any engagement you can access.
					</p>
					<a class="vw-cta vw-cta--primary vw-project__missing-cta" href="/projects">
						Back to all projects
					</a>
				</div>
			</div>
		);
	}

	const { item, project } = showcase;

	return (
		<div class="vw vw-project">
			<ShowcaseStyleAnchor />
			{/* Mobile-only: on desktop the sidebar lane carries Back (hidden via `--laned`). */}
			<div class="vw__back-row vw__back-row--laned">
				<a class="vw__back" href="/projects">← All projects</a>
			</div>

			<ProjectViewHeader item={item} project={project} authed ctx={{ scope: "explore" }} />

			<ProjectShowcaseBody item={item} project={project} emptyState="neutral" />
		</div>
	);
}
