import { define } from "@web/utils/state.ts";
import { PagePlaceholder } from "@web/components/PagePlaceholder.tsx";

export default define.page(function ProjectsPage() {
	return (
		<PagePlaceholder
			title="Projects"
			path="/projects"
			note="Pick a project from the list on the left to open it."
		/>
	);
});
