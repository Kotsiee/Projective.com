import { define } from "@web/utils/state.ts";
import { PagePlaceholder } from "@web/components/PagePlaceholder.tsx";
import ProjectNoticeHost from "@features/projects/islands/ProjectNoticeHost.island.tsx";

/**
 * `/home` — also where the dashboard guard sends a refused surface; {@link ProjectNoticeHost} turns
 * the `?notice=` it carries (e.g. `teams-freelancer`) into one toast and strips it.
 */
export default define.page(function HomePage() {
	return (
		<>
			<PagePlaceholder
				title="Home"
				path="/home"
				note="Persona-adaptive engagement feed (recommended work, activity, profile-setup tracker)."
			/>
			<ProjectNoticeHost />
		</>
	);
});
