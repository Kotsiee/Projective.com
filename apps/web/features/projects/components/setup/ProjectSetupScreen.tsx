import type { JSX } from "preact";
import ProjectSetupForm from "../../islands/ProjectSetupForm.island.tsx";
import ProjectPageStyleAnchor from "../../islands/ProjectPageStyleAnchor.island.tsx";
import type { ProjectSetup } from "../../types/projects-types.ts";

/**
 * ProjectSetupScreen — the body of `/projects/[projectId]` for the CLIENT/owner.
 *
 * `/projects/[projectId]` is a role dispatcher: this is what the person who commissioned the work
 * sees, and {@link ProjectMemberDashboard} is what everybody else does. They are deliberately
 * different surfaces over different reads, because they answer different questions — "is this
 * engagement ready to hire against" versus "what does this engagement want from me". One projection
 * serving both would hand a freelancer the owner's budget fields and hand the owner an assignment
 * list that is always empty.
 *
 * The screen itself is a thin server shell: it renders the miss state, and otherwise mounts the
 * {@link ProjectSetupForm} island. The progress bar and the Details ⁄ Preview switch are NOT here —
 * they live in the middle-nav header band, resolved per-URL by `projectHeaderFor`, and the action rig
 * lives in the footer band. That split is the shell's region contract (DESIGN_SYSTEM.md Part D): the
 * lane navigates, the header band carries identity and range, the footer band owns every action, and
 * the body only views and edits. Three hydration roots share one store (`core/setup-state.ts`), so the
 * bar in the band moves as the owner types in the body.
 *
 * A slug that resolved to nothing renders a calm not-found with the one route back — the same
 * treatment the preview screen gives it, so a mistyped URL reads the same wherever it lands.
 */

// #region Props
/** Props for {@link ProjectSetupScreen}. */
export interface ProjectSetupScreenProps {
	/** The server-resolved configuration, or `null` when the slug matched nothing the viewer owns. */
	setup: ProjectSetup | null;
	/** The routed slug — quoted in the miss branch so the reader can see what was asked for. */
	slug: string;
}
// #endregion

/** The owner's setup surface for one engagement, or a calm miss. */
export function ProjectSetupScreen({ setup, slug }: ProjectSetupScreenProps): JSX.Element {
	if (!setup) {
		return (
			<div class="psu">
				<ProjectPageStyleAnchor />
				<div class="psu__head">
					<h1 class="psu__title">Project not found</h1>
					<p class="psu__lede">
						“{slug}” doesn’t match any engagement you can configure.
					</p>
				</div>
				<p class="psu-note">
					<a href="/projects">Back to all projects</a>
				</p>
			</div>
		);
	}

	return <ProjectSetupForm setup={setup} />;
}
