import { define } from "@web/utils/state.ts";
import { PagePlaceholder } from "@web/components/PagePlaceholder.tsx";
import ProjectNoticeHost from "@features/projects/islands/ProjectNoticeHost.island.tsx";

/**
 * `/projects` — the list surface, and the place every bounced engagement URL lands.
 *
 * The body is still the scaffold placeholder; the lane beside it is the real feed. The one addition
 * is {@link ProjectNoticeHost}, which turns a `?notice=` flash left by a redirect into a single toast
 * and then takes the parameter back out of the address bar. It is mounted here rather than in the
 * dashboard layout because this route is the only target the flash is ever sent to, and a host on the
 * layout would put an empty hydration root on every authenticated page to serve one of them.
 */
export default define.page(function ProjectsPage() {
	return (
		<>
			<ProjectNoticeHost />
			<PagePlaceholder
				title="Projects"
				path="/projects"
				note="Pick a project from the list on the left to open it."
			/>
		</>
	);
});
