import type { JSX } from "preact";
import { useSignal } from "@preact/signals";
import { useEffect } from "preact/hooks";
import type { SavedCollection } from "@projective/types/org";
import { Select } from "@projective/ui/fields";
import { parseTab, SAVED_TABS, TAB_LABEL, tabHasCollections, UNFILED_LABEL } from "../core/saved-model.ts";
import { patchSavedFilter, type SavedFilter } from "../core/saved-filter-state.ts";

/** Props for {@link SavedFilterBar}. */
export interface SavedFilterBarProps {
	filter: SavedFilter;
	lists: readonly SavedCollection[];
}

/** The list filter's "every save" value. */
const ALL = "";

/**
 * SavedFilterBar — below `--bp-md`, where the lane is not shown, the same two filters as selects:
 * the category, and the list.
 */
export function SavedFilterBar({ filter, lists }: SavedFilterBarProps): JSX.Element {
	const tab = useSignal<string>(filter.tab);
	const list = useSignal<string>(filter.collection ?? ALL);
	useEffect(() => {
		tab.value = filter.tab;
		list.value = filter.collection ?? ALL;
	}, [filter.tab, filter.collection]);

	return (
		<div class="svd-filterbar" role="group" aria-label="Filter saved items">
			<Select
				class="svd-filterbar__select"
				size="sm"
				panelWidth="auto"
				aria-label="Category"
				options={SAVED_TABS.map((t) => ({ value: t, label: TAB_LABEL[t] }))}
				value={tab}
				onValueChange={(next) => {
					const nextTab = parseTab(next);
					patchSavedFilter({
						tab: nextTab,
						collection: tabHasCollections(nextTab) ? filter.collection : undefined,
					});
				}}
			/>
			{tabHasCollections(filter.tab) && (
				<Select
					class="svd-filterbar__select"
					size="sm"
					panelWidth="auto"
					aria-label="List"
					options={[
						{ label: "All saved", value: ALL },
						...lists.map((l) => ({ label: l.name, value: l.id })),
						{ label: UNFILED_LABEL, value: "unfiled" },
					]}
					value={list}
					onValueChange={(next) => patchSavedFilter({ collection: next === ALL ? undefined : next })}
				/>
			)}
		</div>
	);
}
