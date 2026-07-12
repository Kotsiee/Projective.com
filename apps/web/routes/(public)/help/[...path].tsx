import { define } from "@web/utils/state.ts";
import { PagePlaceholder } from "@web/components/PagePlaceholder.tsx";

/** Catch-all help/docs route — matches /help, /help/getting-started, /help/a/b/c, etc. */
export default define.page(function HelpPage(ctx) {
	const sub = ctx.params.path ? `/${ctx.params.path}` : "";
	return (
		<PagePlaceholder
			title="Help Center"
			path={`/help${sub}`}
			note="Catch-all documentation route ([...path])."
		/>
	);
});
