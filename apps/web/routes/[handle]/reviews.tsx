import { define } from "@web/utils/state.ts";
import { PagePlaceholder } from "@web/components/PagePlaceholder.tsx";

export default define.page(function ProfileReviewsPage(ctx) {
	return (
		<PagePlaceholder
			title="Reviews"
			path={`/${ctx.params.handle}/reviews`}
			note="Reciprocal reviews (Reliability Index / Client Trust Score)."
		/>
	);
});
