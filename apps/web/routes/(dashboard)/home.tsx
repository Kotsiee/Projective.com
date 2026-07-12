import { define } from "@web/utils/state.ts";
import { PagePlaceholder } from "@web/components/PagePlaceholder.tsx";

export default define.page(function HomePage() {
	return (
		<PagePlaceholder
			title="Home"
			path="/home"
			note="Persona-adaptive engagement feed (recommended work, activity, profile-setup tracker)."
		/>
	);
});
