import { define } from "@web/utils/state.ts";
import { PagePlaceholder } from "@web/components/PagePlaceholder.tsx";

export default define.page(function ProfileHomePage(ctx) {
	return (
		<PagePlaceholder
			title={`@${ctx.params.handle}`}
			path={`/${ctx.params.handle}`}
			note="Public profile home — resolves user / team / corporation by @handle."
		/>
	);
});
