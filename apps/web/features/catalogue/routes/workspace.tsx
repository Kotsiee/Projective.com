import { define } from "@web/utils/state.ts";
import ListingWorkspace from "../islands/ListingWorkspace.island.tsx";
import CatalogueUnavailable from "../islands/CatalogueUnavailable.island.tsx";
import { handler } from "./workspace-handler.ts";

export { handler };

/**
 * `/catalogue/[id]` — the item workspace (Edit · Preview · Analytics · Clients), addressed by the
 * listing's `svc-`/`prd-` slug, the same address its public `/view/[id]` page uses. Thin controller
 * (the route file re-exports it): the {@link handler} guards and reads; the page renders the
 * workspace canvas, or says the listing could not be reached.
 */
export default define.page<typeof handler>(function ListingWorkspacePage({ data }) {
	if (!data.listing || !data.url) {
		return <CatalogueUnavailable message={data.error ?? "We couldn't reach this listing."} />;
	}
	return <ListingWorkspace initial={data.listing} url={data.url} restricted={data.restricted} />;
});
