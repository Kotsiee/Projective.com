import { page } from "fresh";
import { define } from "@web/utils/state.ts";
import { parseCollection, parseTab } from "../core/saved-model.ts";
import SavedPage from "../islands/SavedPage.island.tsx";

/**
 * `/saved` — everything the viewer saved (Decision #174), re-exported by
 * `routes/(dashboard)/saved/index.tsx`. Thin controller: decode the deep link (`?tab=&collection=`;
 * anything unknown falls back to All) and hand it to the island, which reads `/api/saved`. The
 * `(dashboard)` guard has already required a session.
 */
export const handler = define.handlers({
	GET(ctx) {
		const q = ctx.url.searchParams;
		ctx.state.title = "Saved · Projective";
		return page({ tab: parseTab(q.get("tab")), collection: parseCollection(q.get("collection")) });
	},
});

export default define.page<typeof handler>(function SavedScreen({ data }) {
	return <SavedPage initialTab={data.tab} initialCollection={data.collection} />;
});
