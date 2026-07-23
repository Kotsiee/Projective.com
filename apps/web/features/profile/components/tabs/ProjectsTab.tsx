import type { JSX } from "preact";
import { ProjectsList } from "@features/explore/components/collections/ProjectsList.tsx";
import { Empty } from "./tab-shared.tsx";
import type { ProfileTabPayload } from "../../types/profile-types.ts";

/**
 * ProjectsTab — the profile's Projects tab body, split into the Open & available and Past & completed
 * sub-views (root CLAUDE.md Part 2). Reuses the explore {@link ProjectsList} collection.
 */
export function ProjectsTab(
	{ payload, authed }: { payload: ProfileTabPayload; authed: boolean },
): JSX.Element {
	return (
		<div class="pf-projects">
			<section class="pf-projects__group" aria-label="Open projects">
				<h3 class="pf-projects__sub">Open &amp; available</h3>
				{payload.openProjects.length
					? <ProjectsList items={payload.openProjects} authed={authed} />
					: <Empty note="No open projects." />}
			</section>
			<section class="pf-projects__group" aria-label="Past projects">
				<h3 class="pf-projects__sub">Past &amp; completed</h3>
				{payload.pastProjects.length
					? <ProjectsList items={payload.pastProjects} authed={authed} />
					: <Empty note="No completed projects yet." />}
			</section>
		</div>
	);
}
