import { define } from "@web/utils/state.ts";
import ListingSessionPlan from "../islands/ListingSessionPlan.island.tsx";
import CatalogueUnavailable from "../islands/CatalogueUnavailable.island.tsx";
import { planHandler } from "./sub-page-handler.ts";

export const handler = planHandler;

/**
 * `/catalogue/[id]/plan` — a Session's or Group Session's session plan, part of its Edit tab
 * (Decision #525). Thin controller (the route file re-exports it): the {@link handler} guards and
 * reads; the page renders the plan, or says the listing could not be reached.
 */
export default define.page<typeof handler>(function ListingPlanPage({ data }) {
	if (!data.listing || !data.url) {
		return <CatalogueUnavailable message={data.error ?? "We couldn't reach this listing."} />;
	}
	return <ListingSessionPlan initial={data.listing} url={data.url} />;
});
