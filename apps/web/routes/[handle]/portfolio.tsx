import { define } from "@web/utils/state.ts";
import { PagePlaceholder } from "@web/components/PagePlaceholder.tsx";

export default define.page(function ProfilePortfolioPage(ctx) {
	return (
		<PagePlaceholder
			title="Portfolio"
			path={`/${ctx.params.handle}/portfolio`}
			note="Work portfolio items (2D masonry, virtualized)."
		/>
	);
});
