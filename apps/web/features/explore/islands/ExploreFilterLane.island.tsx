import { useEffect } from "preact/hooks";
import { FilterPanel } from "../components/FilterPanel.tsx";
import { activeFilterConfigs } from "../core/filter-config.ts";
import { activeFilterCount, type ExploreParams, withFilter } from "../core/explore-state.ts";
import { bridgeCommit, bridgeFacets, bridgeParams } from "../core/filter-bridge.ts";
import { syncFiltersHidden } from "../core/filter-visibility.ts";

export interface ExploreFilterLaneProps {
	/** SSR seed — the params parsed from the URL by the shell, so the lane paints filters on first byte. */
	initialParams: ExploreParams;
}

/** The locale the numeric boxes format in — fixed so SSR and the client print the same figure. */
const FIGURE_LOCALE = "en-US";

/**
 * ExploreFilterLane — the Search filters for a SIGNED-IN viewer, RELOCATED out of the results body
 * into the authenticated shell's middle-nav lane (`exploreFilterLaneFor` mounts it through the route
 * lane slot). It renders the SAME controlled {@link FilterPanel} the dashboard renders in its guest
 * column and its mobile sheet, so the filter design/patterns are unchanged — only the render location
 * differs by shell. A guest never mounts this island: their column is the dashboard's own
 * (`.ex-dash__aside`), which is why it needs no bridge.
 *
 * State stays in real-time lockstep with the results through the {@link bridgeParams}/{@link bridgeCommit}
 * signal bridge: the lane reads the live params (falling back to its SSR `initialParams` before the
 * {@link SearchDashboard} hydrates) and, on any facet change, commits the next params through the
 * dashboard's own `commit` (which fetches + pushes the shareable URL). The facet LIST is the static
 * per-category config merged with whatever facets the dashboard's payload carried ({@link bridgeFacets}),
 * so a scope-specific facet from the API renders here with no change. Dumb island — it owns no
 * discovery logic and never touches an API directly.
 */
export default function ExploreFilterLane({ initialParams }: ExploreFilterLaneProps) {
	const params = bridgeParams.value ?? initialParams;
	const facets = activeFilterConfigs(params.category, bridgeFacets.value ?? undefined);
	const activeCount = activeFilterCount(params, facets);

	// Reconcile the pre-painted hidden/shown attribute with the cached preference (guest shell only;
	// a no-op elsewhere since nothing but the guest aside reads the attribute).
	useEffect(() => syncFiltersHidden(), []);

	/** Apply a next params set through the dashboard (no-op until it has published its commit). */
	function commit(next: ExploreParams) {
		bridgeCommit.value?.(next);
	}

	function onChange(id: string, values: string[]) {
		commit(withFilter(params, id, values));
	}
	function onClear() {
		commit({ ...params, filters: {} });
	}

	return (
		<div id="explore-filter-lane" class="ex-filters-lane" data-explore-filter-lane>
			<FilterPanel
				facets={facets}
				values={params.filters}
				onChange={onChange}
				onClear={onClear}
				activeCount={activeCount}
				locale={FIGURE_LOCALE}
			/>
		</div>
	);
}
