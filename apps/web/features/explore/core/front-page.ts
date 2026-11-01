import { DEMO_PARAM } from "@features/landing/core/demo-stage.ts";
import { isResultsMode, parseExploreParams } from "./explore-state.ts";

/**
 * Where the front page `/` sends a request instead of rendering the guest Explore Home (Decision
 * #349), or `null` to render it:
 *
 * - a `?demo=` deep link → `/features?demo=…#demo` (the demo stage moved there), for everyone;
 * - a signed-in session, or any search (`?q=`, `?category=`, a facet) → `/explore` with the same
 *   query, so the signed-in hub and the results each have one address.
 *
 * Pure, so the thin route's dispatch is unit-tested without a server.
 */
export function frontPageRedirect(url: URL, signedIn: boolean): string | null {
	const demo = url.searchParams.get(DEMO_PARAM);
	if (demo !== null) return `/features?${new URLSearchParams({ [DEMO_PARAM]: demo })}#demo`;
	if (signedIn || isResultsMode(parseExploreParams(url.searchParams))) {
		return `/explore${url.search}`;
	}
	return null;
}
