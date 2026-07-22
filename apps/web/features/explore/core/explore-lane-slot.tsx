import type { ComponentChildren } from "preact";
import ExploreFilterLane from "../islands/ExploreFilterLane.island.tsx";
import { isResultsMode, parseExploreParams } from "./explore-state.ts";

/**
 * exploreFilterLaneFor — the SSR-idiomatic route resolver that decides whether the Search filters mount
 * in the navigation sidebar for a given URL. It mirrors the shell's other URL-keyed slot resolvers
 * (`laneFor` / `channelHeaderFor`): a pure function of the URL, evaluated by the `(public)` layout, so
 * the correct lane paints on the first byte with no client-context flash.
 *
 * Returns the {@link ExploreFilterLane} island (seeded with the parsed params) only on `/explore` in
 * Search Results mode (State B); `null` on the Home feed (State A) and every other route, where the
 * shell renders no aside/lane.
 */
export function exploreFilterLaneFor(url: URL): ComponentChildren | null {
	if (url.pathname !== "/explore") return null;
	const params = parseExploreParams(url.searchParams);
	if (!isResultsMode(params)) return null;
	return <ExploreFilterLane initialParams={params} />;
}
