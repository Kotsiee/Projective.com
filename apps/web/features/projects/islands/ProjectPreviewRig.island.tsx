import type { JSX } from "preact";
import "../styles/project-preview-rig.css";
import { ProjectActions } from "@features/view/components/ProjectActions.tsx";
import type { ExploreItem } from "@projective/types/explore";

/**
 * ProjectPreviewRig — the engagement preview's action rig in the middle-nav FOOTER band
 * (`/projects/[projectId]`).
 *
 * It exists because the preview had no always-visible call to action on desktop. The body copy of
 * "Apply to project" lives in `.pf-header__actions`, which the profile stylesheet sets to
 * `display: none` above 767px — correct on `/[handle]`, where the `pf-lane` carries a Hire/Message
 * copy, and correct on `/view/[id]`, where the guest lane carries `.vw-projlane__apply`. The
 * dashboard lane is the Project Details channel tree and carries neither, so the only remaining copy
 * was the reveal-on-scroll one inside `.pf-stickyhead` — measured `0×0` until roughly 437px of
 * scroll. The reader had to scroll past the thing they came to act on.
 *
 * Putting it in the footer band is also simply where it belongs: the band owns actions, the body
 * owns viewing and selecting (the `/wallet` region contract).
 *
 * It is an ISLAND for two reasons: it bundles its stylesheet (feature CSS reaches a page only
 * through an island bundle), and {@link ProjectActions} reads the module-level `projectApplied`
 * signal, so it must sit in a hydrated tree to stay in lockstep with the body/sticky copies.
 *
 * Below `--bp-md` the rig hides and the body copy — which the same media query reveals — takes over,
 * so exactly one copy is visible at every width. That is the split `profile.css` already documents
 * for the profile's own Hire button.
 */
export interface ProjectPreviewRigProps {
	/** The resolved engagement, passed straight through to {@link ProjectActions}. */
	item: ExploreItem;
	/** Whether the viewer is signed in (always true inside the `(dashboard)` guard). */
	authed: boolean;
}

export default function ProjectPreviewRig({ item, authed }: ProjectPreviewRigProps): JSX.Element {
	return (
		<div class="proj-pvrig">
			<p class="proj-pvrig__note">
				Applying puts you forward for an open seat. The client reviews every application.
			</p>
			<div class="proj-pvrig__actions">
				<ProjectActions item={item} authed={authed} ctx={{ scope: "explore" }} />
			</div>
		</div>
	);
}
