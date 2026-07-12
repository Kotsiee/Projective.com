import { define } from "@web/utils/state.ts";
import { PagePlaceholder } from "@web/components/PagePlaceholder.tsx";

export default define.page(function BusinessDetailPage(ctx) {
	return (
		<PagePlaceholder
			title="Business"
			path={`/business/${ctx.params.businessId}`}
			note="Business overview: members, projects, billing, invoices, wallet."
		/>
	);
});
