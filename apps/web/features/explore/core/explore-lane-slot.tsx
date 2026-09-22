import type { ComponentChildren } from "preact";
import ExploreFilterLane from "../islands/ExploreFilterLane.island.tsx";
import { isResultsMode, parseExploreParams } from "./explore-state.ts";

/**
 * exploreFilterLaneFor — the SSR-idiomatic route resolver that decides whether the Search filters mount
 * in the shell's navigation lane for a given URL. It mirrors the shell's other URL-keyed slot resolvers
 * (`laneFor` / `channelHeaderFor` / `viewLaneFor`): a pure function of the URL (+ auth), evaluated by
 * the `(public)` layout, so the correct lane paints on the first byte with no client-context flash.
 *
 * Returns the {@link ExploreFilterLane} island (seeded with the parsed params) only for an
 * AUTHENTICATED viewer on `/explore` in Search Results mode (State B) — the middle-nav lane of the
 * authenticated frame is a full-height column beside the content pane, which is where that frame
 * keeps every laned surface's navigation.
 *
 * A GUEST gets `null`: the guest filter column is rendered by the {@link SearchDashboard} island
 * itself, as the inline-start column of the results BODY, so it starts where the results bar starts
 * and the results head above it spans the whole page. The shell's floating aside can only sit beside
 * the whole body, head included — a lane whose placement is a function of the page's own layout is
 * the page's to render (the `/view` conversion rail, `viewLaneFor`, is the precedent). Returning
 * `null` rather than an empty lane matters: an un-rendered aside costs no region, no gutter and no
 * flex-column shell, where a hidden one keeps all three.
 *
 * `null` on the Home feed (State A) and every other route in both shells.
 */
export function exploreFilterLaneFor(url: URL, authed: boolean): ComponentChildren | null {
	if (!authed) return null;
	if (url.pathname !== "/explore") return null;
	const params = parseExploreParams(url.searchParams);
	if (!isResultsMode(params)) return null;
	return <ExploreFilterLane initialParams={params} />;
}
