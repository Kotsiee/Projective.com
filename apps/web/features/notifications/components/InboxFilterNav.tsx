import type { JSX } from "preact";
import type { NotificationSummary } from "@projective/types/comms";
import { NavItem } from "@projective/ui/navigation";
import { Icon } from "@projective/ui/icons";
import {
	countLabel,
	INBOX_TABS,
	INBOX_VIEWS,
	type InboxFilter,
	inboxHref,
	type InboxTab,
	type InboxView,
	TAB_LABEL,
	tabUnread,
	VIEW_LANE_LABEL,
} from "../core/notification-model.ts";
import { TAB_ICON, VIEW_ICON } from "../core/inbox-icons.ts";

/** One row of the lane's filter navigation, as the expanded lane and the collapsed rail both draw it. */
export interface InboxNavEntry {
	key: string;
	label: string;
	icon: JSX.Element;
	href: string;
	active: boolean;
	/** The row's figure, or `null` when it has none to show. */
	count: number | null;
	/** The accessible name, the figure spoken in words. */
	name: string;
	patch: Partial<InboxFilter>;
}

/** The status views: every view carries the inbox-wide figure the summary has for it. */
export function viewEntries(
	filter: InboxFilter,
	summary: NotificationSummary | null,
): InboxNavEntry[] {
	return INBOX_VIEWS.map((view: InboxView) => {
		const count = !summary || view === "archived"
			? null
			: view === "all"
			? summary.total
			: summary.unread || null;
		const label = VIEW_LANE_LABEL[view];
		return {
			key: view,
			label,
			icon: <Icon name={VIEW_ICON[view]} size="md" />,
			href: inboxHref(filter.tab, view, filter.query),
			active: filter.view === view,
			count,
			name: count === null
				? label
				: view === "all"
				? `${label}, ${count} in the inbox`
				: `${label}, ${count} notifications`,
			patch: { view },
		};
	});
}

/** The category filters, each with its unread figure once there is one. */
export function categoryEntries(
	filter: InboxFilter,
	summary: NotificationSummary | null,
): InboxNavEntry[] {
	return INBOX_TABS.map((tab: InboxTab) => {
		const unread = tabUnread(summary, tab);
		const label = TAB_LABEL[tab];
		return {
			key: tab,
			label,
			icon: <Icon name={TAB_ICON[tab]} size="md" />,
			href: inboxHref(tab, filter.view, filter.query),
			active: filter.tab === tab,
			count: unread > 0 ? unread : null,
			name: unread > 0 ? `${label}, ${unread} unread` : label,
			patch: { tab },
		};
	});
}

/** Props for {@link InboxFilterNav}. */
export interface InboxFilterNavProps {
	label: string;
	entries: readonly InboxNavEntry[];
	/** A plain press on a row; answers whether the page took it in place. */
	onPick: (entry: InboxNavEntry) => boolean;
}

/**
 * InboxFilterNav — one group of the `/notifications` lane as the lanes' shared `NavItem` rows: glyph,
 * label, and the figure as plain `tabular-nums` text at the row's end, spoken in the row's name. Every
 * row is the real address of its filter; a plain press is answered in place by the page, and a
 * modified one (new tab, new window) is left to the browser.
 */
export function InboxFilterNav(props: InboxFilterNavProps): JSX.Element {
	return (
		<nav aria-label={props.label}>
			<ul class="ntf-lane__navlist" role="list">
				{props.entries.map((entry) => (
					<li key={entry.key}>
						<NavItem
							href={entry.href}
							label={entry.label}
							aria-label={entry.name}
							icon={entry.icon}
							active={entry.active ? "true" : undefined}
							trailing={entry.count === null
								? undefined
								: <span class="ntf-lane__count">{countLabel(entry.count)}</span>}
							onClick={(event) => {
								if (event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
								if (props.onPick(entry)) event.preventDefault();
							}}
						/>
					</li>
				))}
			</ul>
		</nav>
	);
}
