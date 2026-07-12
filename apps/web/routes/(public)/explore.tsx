import { define } from "@web/utils/state.ts";
import { PagePlaceholder } from "@web/components/PagePlaceholder.tsx";

export default define.page(function ExplorePage() {
	return (
		<PagePlaceholder
			title="Explore"
			path="/explore"
			note="Discovery/search — Workload-aware ranking, Reliability Index, Discovery Boost (PRODUCT_SPEC §Reputation & Discovery)."
		/>
	);
});
