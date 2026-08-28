import type { JSX } from "preact";
import "../styles/explore.css";
import "../styles/explore-results.css";
import { ExploreHome } from "./ExploreHome.tsx";
import SearchDashboard from "../islands/SearchDashboard.island.tsx";
import CardStyleAnchor from "../islands/CardStyleAnchor.island.tsx";
import AmbientPalette from "../islands/AmbientPalette.island.tsx";
import ViewHistory from "../islands/ViewHistory.island.tsx";
import { isResultsMode } from "../core/explore-state.ts";
import type { ExploreParams } from "../core/explore-state.ts";
import type { HomeFeed, SearchPayload } from "../types/explore-types.ts";
import type { HrefContext } from "../core/routing.ts";

/**
 * ExploreScreen — the `/explore` composition + the State A / State B switch. The server has already
 * parsed the URL into {@link ExploreParams} and resolved the first-paint data from the fat service:
 * a {@link HomeFeed} for the discovery Home (its premium header owns the ONE large search bar), or an
 * initial {@link SearchPayload} for the Search Results dashboard island (no in-body search bar — the
 * active query lives in the global nav header). Full-bleed inside the public shell's `.site__main`.
 */
export function ExploreScreen(
	{ params, home, initial, ctx = { scope: "explore" }, authed = false }: {
		params: ExploreParams;
		home?: HomeFeed;
		initial?: SearchPayload;
		ctx?: HrefContext;
		authed?: boolean;
	},
): JSX.Element {
	const results = isResultsMode(params);
	return (
		<div class="ex" data-mode={results ? "results" : "home"}>
			{
				/* Anchors the shared card CSS (Avatar/RatingStars) into the page's island bundle — the static
			    Home has no other island carrying it. See CardStyleAnchor for the full rationale. */
			}
			<CardStyleAnchor />
			{
				/* Extracts each card's dominant media colour into `--ex-ambient` for the hover wash. Renders
			    nothing; cards already paint a token-derived fallback, so this only ever upgrades them. */
			}
			<AmbientPalette />
			{
				/* Records which items this DEVICE opens, so the Home's "Continue where you left off" rail
			    and the footer's "Recently viewed" stack have something true to read. Renders nothing;
			    finds its subjects by `data-item-id` rather than being threaded through every card, so the
			    cards stay server components. */
			}
			<ViewHistory />
			{results
				? (
					<SearchDashboard
						initialParams={params}
						initial={initial}
						ctx={ctx}
						authed={authed}
					/>
				)
				: home
				? <ExploreHome feed={home} authed={authed} />
				: null}
		</div>
	);
}
