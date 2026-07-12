import { define } from "@web/utils/state.ts";
import { PagePlaceholder } from "@web/components/PagePlaceholder.tsx";

export default define.page(function ServicesPage() {
	return (
		<PagePlaceholder
			title="Services"
			path="/services"
			note="Freelancer-architected productized services (Sessions / Pipelines)."
		/>
	);
});
