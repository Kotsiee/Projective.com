import { define } from "@web/utils/state.ts";
import { PagePlaceholder } from "@web/components/PagePlaceholder.tsx";

export default define.page(function LandingPage() {
	return (
		<PagePlaceholder
			title="Projective"
			path="/"
			note="Landing page. Public marketing surface — hire teams, stage-based projects, escrow-backed."
		/>
	);
});
