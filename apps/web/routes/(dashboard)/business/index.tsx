import { define } from "@web/utils/state.ts";
import { PagePlaceholder } from "@web/components/PagePlaceholder.tsx";

export default define.page(function BusinessesPage() {
	return (
		<PagePlaceholder
			title="Businesses"
			path="/business"
			note="Client/Operator-Mode surface (gated). Business entities & pooled wallets."
		/>
	);
});
