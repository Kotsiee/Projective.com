import { FilterPanel } from "../components/FilterPanel.tsx";
import { FILTER_CONFIG } from "../core/filter-config.ts";
import { activeFilterCount, type ExploreParams, withFilter } from "../core/explore-state.ts";
import { bridgeCommit, bridgeParams } from "../core/filter-bridge.ts";

export interface ExploreFilterLaneProps {
	/** SSR seed — the params parsed from the URL by the shell, so the lane paints filters on first byte. */
	initialParams: ExploreParams;
}

/**
 * ExploreFilterLane — the Search filters, RELOCATED out of the results body into the navigation sidebar
 * (the guest `ui-guest-aside` for signed-out visitors, the authed middle-nav lane for signed-in ones).
 * The shell mounts it via the route lane slot; it renders the SAME controlled {@link FilterPanel} the
 * dashboard's mobile sheet uses, so the filter design/patterns are unchanged — only the render location
 * moved.
 *
 * State stays in real-time lockstep with the results through the {@link bridgeParams}/{@link bridgeCommit}
 * signal bridge: the lane reads the live params (falling back to its SSR `initialParams` before the
 * {@link SearchDashboard} hydrates) and, on any facet change, commits the next params through the
 * dashboard's own `commit` (which fetches + pushes the shareable URL). Dumb island — it owns no
 * discovery logic and never touches an API directly.
 */
export default function ExploreFilterLane({ initialParams }: ExploreFilterLaneProps) {
	const params = bridgeParams.value ?? initialParams;
	const groups = FILTER_CONFIG[params.category];
	const activeCount = activeFilterCount(params);

	/** Apply a next params set through the dashboard (no-op until it has published its commit). */
	function commit(next: ExploreParams) {
		bridgeCommit.value?.(next);
	}

	function onToggle(id: string, value: string) {
		const current = params.filters[id] ?? [];
		const nextValues = current.includes(value)
			? current.filter((v) => v !== value)
			: [...current, value];
		commit(withFilter(params, id, nextValues));
	}
	function onSetRange(id: string, value: number) {
		commit(withFilter(params, id, [String(value)]));
	}
	function onSetSelect(id: string, value: string) {
		commit(withFilter(params, id, value ? [value] : []));
	}
	function onClear() {
		commit({ ...params, filters: {} });
	}

	return (
		<div class="ex-filters-lane" data-explore-filter-lane>
			<FilterPanel
				category={params.category}
				groups={groups}
				values={params.filters}
				onToggle={onToggle}
				onSetRange={onSetRange}
				onSetSelect={onSetSelect}
				onClear={onClear}
				activeCount={activeCount}
			/>
		</div>
	);
}
