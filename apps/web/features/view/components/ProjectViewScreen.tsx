import type { JSX } from "preact";
import "../styles/project-view.css";
import ProjectViewHeader from "../islands/ProjectViewHeader.island.tsx";
import { ProjectShowcaseBody } from "./ProjectShowcaseBody.tsx";
import { backHrefFor, backLabelFor } from "../core/view-model.ts";
import type { EntityView, ProjectViewExtra } from "@projective/types/explore";
import type { HrefContext } from "@features/explore/core/routing.ts";

/**
 * ProjectViewScreen — the custom **Projects** view template body (`/view/[id]?type=projects`). It leads
 * with the profile-mirroring {@link ProjectViewHeader} (uploader banner/avatar chrome, adapted to the
 * project), then the shared {@link ProjectShowcaseBody} (owner summary + classification-tailored
 * metadata + the interactive stage-flow visualizer) — the SAME body the authenticated
 * `/projects/[id]` Preview reuses, so the showcase layout stays in lockstep across both surfaces. Per
 * the brief it renders a single primary CTA (Apply, in the header + the side lane), and deliberately NO
 * generic "More by…", "Similar", or "Reviews" sections — the sidebar action lane + stage jumps carry
 * the navigation instead. Details are tailored to the project's {@link ProjectViewExtra.classification}
 * (Pipeline vs One-Off); there is no escrow chrome.
 */
export function ProjectViewScreen(
	{ view, project, ctx, authed }: {
		view: EntityView;
		project: ProjectViewExtra;
		ctx: HrefContext;
		authed: boolean;
	},
): JSX.Element {
	return (
		<div class="vw vw-project">
			{/* Mobile-only: on desktop the side-nav lane header carries Back (hidden via `--laned`). */}
			<div class="vw__back-row vw__back-row--laned">
				<a class="vw__back" href={backHrefFor(ctx)}>← {backLabelFor(ctx)}</a>
			</div>

			<ProjectViewHeader item={view.item} project={project} authed={authed} ctx={ctx} />

			<ProjectShowcaseBody item={view.item} project={project} />
		</div>
	);
}
