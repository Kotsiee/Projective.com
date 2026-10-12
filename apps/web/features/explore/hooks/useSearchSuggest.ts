import { useEffect, useMemo } from "preact/hooks";
import { ExploreService } from "../core/ExploreService.ts";
import {
	createSuggestController,
	SUGGEST_DEBOUNCE_MS,
	type SuggestController,
} from "../core/suggest-controller.ts";
import type { ExploreCategory } from "../types/explore-types.ts";

/**
 * useSearchSuggest — the typeahead state behind `SearchSuggest`: one {@link SuggestController} per
 * mounted bar, fetching `/api/explore/suggest` through {@link ExploreService.suggest} with a
 * {@link SUGGEST_DEBOUNCE_MS} debounce, an `AbortController` per request and a request sequence
 * number. Follows the bar's `scope`, and cancels everything on unmount.
 */
export function useSearchSuggest(scope: ExploreCategory): SuggestController {
	const ctrl = useMemo(
		() =>
			createSuggestController({
				fetcher: (query, signal) => ExploreService.suggest(query, signal),
				scope,
				delayMs: SUGGEST_DEBOUNCE_MS,
			}),
		[],
	);
	useEffect(() => ctrl.setScope(scope), [scope]);
	useEffect(() => () => ctrl.dispose(), []);
	return ctrl;
}
