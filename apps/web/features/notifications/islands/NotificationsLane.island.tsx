import type { JSX } from "preact";
import { useSignal } from "@preact/signals";
import { useEffect } from "preact/hooks";
import "../styles/notifications-lane.css";
import { Icon } from "@projective/ui/icons";
import {
	LaneCollapseButton,
	LaneFooter,
	LaneHead,
	LaneList,
	LaneSection,
	LaneSections,
} from "@projective/ui/navigation";
import { LaneSearchField } from "@features/shortcuts/components/LaneSearchField.tsx";
import { SidebarToggleIcon } from "@web/features/shell/core/nav-icons.tsx";
import { MIDDLE_LANE_TOGGLE_EVENT } from "@web/utils/lane-events.ts";
import type { InboxFilter } from "../core/notification-model.ts";
import { inboxSummary } from "../core/notification-state.ts";
import { inboxFilter, patchInboxFilter } from "../core/inbox-filter-state.ts";
import { useInboxSearch } from "../hooks/useInboxSearch.ts";
import {
	categoryEntries,
	InboxFilterNav,
	type InboxNavEntry,
	viewEntries,
} from "../components/InboxFilterNav.tsx";
import { InboxLaneRail } from "../components/InboxLaneRail.tsx";

/** Props for {@link NotificationsLane}. */
export interface NotificationsLaneProps {
	/** The filter the request's URL addressed; the shared filter takes over once the page mounts. */
	filter: InboxFilter;
}

/**
 * NotificationsLane — the `/notifications` middle-nav lane (DESIGN_SYSTEM §D.9.2): the find-in-inbox
 * search in the head, then two sections of `NavItem` rows — the status views (All notifications ·
 * Unread · Archived) and the categories — each the real address of its filter and answered in place by
 * the page through the shared filter. Figures come from the header's one `/summary` poller. Renders
 * both presentations and lets `.ui-splitter[data-mode="collapsed"]` reveal one, like every other lane.
 */
export default function NotificationsLane(props: NotificationsLaneProps): JSX.Element {
	const collapsed = useSignal(false);
	const viewsOpen = useSignal(true);
	const categoriesOpen = useSignal(true);
	const filter = inboxFilter.value ?? props.filter;
	const summary = inboxSummary.value;
	const search = useInboxSearch(filter);

	useEffect(() => {
		const el = document.querySelector<HTMLElement>(".ui-splitter");
		collapsed.value = el?.dataset.mode === "collapsed";
	}, []);

	const setCollapsed = (next: boolean) => {
		collapsed.value = next;
		globalThis.dispatchEvent(
			new CustomEvent(MIDDLE_LANE_TOGGLE_EVENT, { detail: { collapsed: next } }),
		);
	};

	const pick = (entry: InboxNavEntry) => patchInboxFilter(entry.patch);
	const views = viewEntries(filter, summary);
	const categories = categoryEntries(filter, summary);

	return (
		<div class="ntf-lane">
			<InboxLaneRail
				views={views}
				categories={categories}
				onPick={pick}
				onExpand={() => setCollapsed(false)}
			/>

			<div class="ntf-lane__full">
				<LaneHead>
					<LaneSearchField
						value={search.draft.value}
						placeholder="Search notifications"
						label="Search notifications"
						icon={<Icon name="search" />}
						onInput={search.onInput}
					/>
				</LaneHead>

				<LaneList label="Notification filters">
					<LaneSections>
						<LaneSection
							id="ntf-views"
							icon={<Icon name="inbox" />}
							label="Views"
							open={viewsOpen.value}
							onToggle={() => (viewsOpen.value = !viewsOpen.value)}
						>
							<InboxFilterNav label="Notification views" entries={views} onPick={pick} />
						</LaneSection>
						<LaneSection
							id="ntf-categories"
							icon={<Icon name="grid" />}
							label="Categories"
							open={categoriesOpen.value}
							onToggle={() => (categoriesOpen.value = !categoriesOpen.value)}
						>
							<InboxFilterNav label="Categories" entries={categories} onPick={pick} />
						</LaneSection>
					</LaneSections>
				</LaneList>

				<LaneFooter>
					<LaneCollapseButton
						collapsed={collapsed.value}
						icon={<SidebarToggleIcon />}
						onToggle={() => setCollapsed(!collapsed.value)}
					/>
				</LaneFooter>
			</div>
		</div>
	);
}
