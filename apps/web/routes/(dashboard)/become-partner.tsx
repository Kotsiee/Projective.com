import { define } from "@web/utils/state.ts";
import { PagePlaceholder } from "@web/components/PagePlaceholder.tsx";

export default define.page(function BecomePartnerPage() {
	return (
		<PagePlaceholder
			title="Become a Partner"
			path="/become-partner"
			note="Freelancer conversion funnel (Client/Operator → unlock freelancer suite)."
		/>
	);
});
