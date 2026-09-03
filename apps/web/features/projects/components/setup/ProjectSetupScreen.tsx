import type { JSX } from "preact";
import ProjectSetupForm from "../../islands/ProjectSetupForm.island.tsx";
import ProjectPageStyleAnchor from "../../islands/ProjectPageStyleAnchor.island.tsx";
import SetupSectionNav from "../../islands/SetupSectionNav.island.tsx";
import type { ProjectSetup } from "../../types/projects-types.ts";

/**
 * ProjectSetupScreen — the body of `/projects/[projectId]` for the CLIENT/owner, and the two-column
 * shell the Stage-2 workspace lays out in.
 *
 * `/projects/[projectId]` is a role dispatcher: this is what the person who commissioned the work
 * sees, and {@link ProjectMemberDashboard} is what everybody else does. They are deliberately
 * different surfaces over different reads, because they answer different questions — "is this
 * engagement ready to hire against" versus "what does this engagement want from me". One projection
 * serving both would hand a freelancer the owner's budget fields and hand the owner an assignment
 * list that is always empty.
 *
 * The shell is a grid of two columns: the sticky section rail, and the form. The rail is deliberately
 * OUTSIDE the form's reading measure — a form field wider than ~44rem stops being scannable, but the
 * rail is not prose and confining it to that measure would take the width out of the column that
 * needs it. Below the tablet cusp the grid collapses to one column and the rail lays itself out
 * horizontally; it is never removed, because there is no other route between the sections on this
 * surface for the duty to transfer to.
 *
 * The progress bar and the Details ⁄ Preview switch are NOT here — they live in the middle-nav header
 * band, resolved per-URL by `projectHeaderFor`, and the action rig lives in the footer band. That
 * split is the shell's region contract (DESIGN_SYSTEM.md Part D): the lane navigates, the header band
 * carries identity and range, the footer band owns every action, and the body only views and edits.
 * Four hydration roots share one store (`core/setup-state.ts`), so the bar in the band moves as the
 * owner types in the body.
 *
 * A reference that resolved to nothing renders a calm not-found with the one route back. It does NOT
 * quote what was asked for: every `/projects` address is now a uuid, and reading a uuid back at
 * somebody tells them nothing they can act on while making a plain miss look like a system fault.
 */

// #region Props
/** Props for {@link ProjectSetupScreen}. */
export interface ProjectSetupScreenProps {
	/** The server-resolved configuration, or `null` when the reference matched nothing the viewer owns. */
	setup: ProjectSetup | null;
	/** The routed reference — a uuid, or the readable slug. Not rendered; kept for the route's contract. */
	slug: string;
}
// #endregion

/** The owner's Stage-2 workspace for one engagement, or a calm miss. */
export function ProjectSetupScreen({ setup }: ProjectSetupScreenProps): JSX.Element {
	if (!setup) {
		return (
			<div class="psu">
				<ProjectPageStyleAnchor />
				<div class="psu__head">
					<h1 class="psu__title">Project not found</h1>
					<p class="psu__lede">
						This project either doesn’t exist or isn’t one you can configure.
					</p>
				</div>
				<p class="psu-note">
					<a href="/projects">Back to all projects</a>
				</p>
			</div>
		);
	}

	return (
		/*
		 * Both children are DIRECT grid items, with no wrapper of their own. The rail's stylesheet is
		 * written for exactly that — it opts out of the stretch itself so it can be sticky — and a
		 * wrapper would put a block box between it and the grid area its sticky offset resolves against.
		 */
		<div class="psu-shell">
			<SetupSectionNav setup={setup} />
			<ProjectSetupForm setup={setup} />
		</div>
	);
}
