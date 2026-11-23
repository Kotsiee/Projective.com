import { define } from "@web/utils/state.ts";
import ListingQuestions from "../islands/ListingQuestions.island.tsx";
import CatalogueUnavailable from "../islands/CatalogueUnavailable.island.tsx";
import { questionsHandler } from "./sub-page-handler.ts";

export const handler = questionsHandler;

/**
 * `/catalogue/[id]/questions` — a service's buyer-questions builder, part of its Edit tab (Decision
 * #525). Thin controller (the route file re-exports it): the {@link handler} guards and reads; the
 * page renders the builder, or says the listing could not be reached.
 */
export default define.page<typeof handler>(function ListingQuestionsPage({ data }) {
	if (!data.listing || !data.url) {
		return <CatalogueUnavailable message={data.error ?? "We couldn't reach this listing."} />;
	}
	return <ListingQuestions initial={data.listing} url={data.url} />;
});
