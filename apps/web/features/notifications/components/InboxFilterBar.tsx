import type { JSX } from "preact";
import { useSignal } from "@preact/signals";
import { useEffect } from "preact/hooks";
import type { NotificationSummary } from "@projective/types/comms";
import { Select } from "@projective/ui/fields";
import { LaneSearch } from "@projective/ui/navigation";
import { Icon } from "@projective/ui/icons";
import {
	INBOX_VIEWS,
	type InboxFilter,
	type InboxView,
	parseTab,
	VIEW_LABEL,
} from "../core/notification-model.ts";
import { patchInboxFilter } from "../core/inbox-filter-state.ts";
import { useInboxSearch } from "../hooks/useInboxSearch.ts";
import { categoryOptions } from "../core/category-options.ts";

/** Props for {@link InboxFilterBar}. */
export interface InboxFilterBarProps {
	filter: InboxFilter;
	summary: NotificationSummary | null;
}

/**
 * InboxFilterBar — the lane's duty on a phone (DESIGN_SYSTEM §D.3 strips the middle-nav lane below
 * `--bp-md`): the status view and the category as two compact `Select`s and the search, on one
 * wrapping row at the top of `/notifications`. Hidden from `--bp-md` up, where the lane holds them. It
 * writes the same shared filter the lane does, so the two can never disagree.
 */
export function InboxFilterBar(props: InboxFilterBarProps): JSX.Element {
	const view = useSignal<string>(props.filter.view);
	const tab = useSignal<string>(props.filter.tab);
	useEffect(() => {
		view.value = props.filter.view;
		tab.value = props.filter.tab;
	}, [props.filter.view, props.filter.tab]);
	const search = useInboxSearch(props.filter);

	return (
		<div class="ntf-filterbar" role="group" aria-label="Filter notifications">
			<Select
				class="ntf-filterbar__select"
				size="sm"
				panelWidth="auto"
				aria-label="Status"
				options={INBOX_VIEWS.map((v) => ({ value: v, label: VIEW_LABEL[v] }))}
				value={view}
				onValueChange={(next) => patchInboxFilter({ view: next as InboxView })}
			/>
			<Select
				class="ntf-filterbar__select"
				size="sm"
				panelWidth="auto"
				aria-label="Category"
				options={categoryOptions(props.summary)}
				value={tab}
				onValueChange={(next) => patchInboxFilter({ tab: parseTab(next) })}
			/>
			<div class="ntf-filterbar__search">
				<LaneSearch
					value={search.draft.value}
					placeholder="Search notifications"
					label="Search notifications"
					icon={<Icon name="search" />}
					onInput={search.onInput}
				/>
			</div>
		</div>
	);
}
