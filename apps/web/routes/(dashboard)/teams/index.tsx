import { define } from "@web/utils/state.ts";
import { PagePlaceholder } from "@web/components/PagePlaceholder.tsx";

export default define.page(function TeamsPage() {
	return (
		<PagePlaceholder
			title="Teams"
			path="/teams"
			note="Freelancer-only 'Virtual Agency' space (hidden from Client persona)."
		/>
	);
});
