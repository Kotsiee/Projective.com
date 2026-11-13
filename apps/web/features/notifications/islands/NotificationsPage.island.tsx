import type { JSX } from "preact";
import { useComputed, useSignal, useSignalEffect } from "@preact/signals";
import { useEffect } from "preact/hooks";
import "../styles/notifications.css";
import type { NotificationInboxItem } from "@projective/types/comms";
import { Checkbox } from "@projective/ui/fields";
import {
	emptyCopy,
	type InboxFilter,
	inboxHref,
	TAB_LABEL,
	tabUnread,
	VIEW_LABEL,
} from "../core/notification-model.ts";
import { inboxSummary } from "../core/notification-state.ts";
import { inboxFilter } from "../core/inbox-filter-state.ts";
import { useNotificationFeed } from "../core/useNotificationFeed.ts";
import { NotificationList } from "../components/NotificationList.tsx";
import { InboxFilterBar } from "../components/InboxFilterBar.tsx";
import { NotificationsPageHeader } from "../components/NotificationsPageHeader.tsx";

/** Props for {@link NotificationsPage}. */
export interface NotificationsPageProps {
	/** The filter decoded from `?category=&view=&q=`. */
	initial: InboxFilter;
}

function panelLabel(filter: InboxFilter): string {
	const scope = filter.tab === "all"
		? "All notifications"
		: `${TAB_LABEL[filter.tab]} notifications`;
	const view = filter.view === "all" ? "" : `, ${VIEW_LABEL[filter.view].toLowerCase()}`;
	const query = filter.query ? `, matching “${filter.query}”` : "";
	return `${scope}${view}${query}`;
}

/**
 * NotificationsPage — the `/notifications` body (DESIGN_SYSTEM §D.9.2). The filter lives in the
 * middle-nav lane (and, below `--bp-md`, the phone filter bar), shared through `inboxFilter`; this
 * island seeds it from the URL it was rendered for and keeps the address on it (`?category=&view=&q=`,
 * replaced in place), so whatever is on screen is a deep link. The body is the header — title,
 * unread figure, bulk or mark-all actions, Notification settings — then the rows, keyset "Load more"
 * and bulk select. Live arrivals come from the header's shared `/summary` poller.
 */
export default function NotificationsPage(props: NotificationsPageProps): JSX.Element {
	const filter = useComputed(() => inboxFilter.value ?? props.initial);
	const tab = useComputed(() => filter.value.tab);
	const view = useComputed(() => filter.value.view);
	const query = useComputed(() => filter.value.query);
	const active = useSignal(true);
	const feed = useNotificationFeed({ tab, view, query, active });
	const selected = useSignal<ReadonlySet<string>>(new Set());

	useEffect(() => {
		inboxFilter.value = props.initial;
		return () => {
			inboxFilter.value = null;
		};
	}, []);

	useSignalEffect(() => {
		const { tab: t, view: v, query: q } = filter.value;
		const href = inboxHref(t, v, q);
		selected.value = new Set();
		if (globalThis.location && location.pathname + location.search !== href) {
			history.replaceState(history.state, "", href);
		}
	});

	useSignalEffect(() => {
		const ids = new Set(feed.items.value.map((i) => i.id));
		const kept = [...selected.peek()].filter((id) => ids.has(id));
		if (kept.length !== selected.peek().size) selected.value = new Set(kept);
	});

	const current = filter.value;
	const items = feed.items.value;
	const chosen = selected.value;
	const selectable = current.view !== "archived";
	const unread = tabUnread(inboxSummary.value, current.tab);
	const empty = emptyCopy(current.tab, current.view, current.query);
	const allChosen = items.length > 0 && chosen.size === items.length;
	const allTicked = useSignal(allChosen);
	useEffect(() => {
		allTicked.value = allChosen;
	}, [allChosen]);

	const toggle = (item: NotificationInboxItem, on: boolean) => {
		const next = new Set(chosen);
		if (on) next.add(item.id);
		else next.delete(item.id);
		selected.value = next;
	};
	const bulk = (run: (ids: string[]) => Promise<void>) => {
		const ids = [...chosen];
		selected.value = new Set();
		void run(ids);
	};

	return (
		<div class="ntf-page">
			<NotificationsPageHeader
				tab={current.tab}
				unread={inboxSummary.value ? unread : null}
				selectedCount={selectable ? chosen.size : 0}
				canMarkAll={selectable}
				onMarkAll={() => void feed.markAllRead()}
				onMarkSelected={() => bulk((ids) => feed.markRead(ids))}
				onArchiveSelected={() => bulk(feed.archive)}
			/>

			<InboxFilterBar filter={current} summary={inboxSummary.value} />

			{selectable && items.length > 0 && feed.phase.value === "ready"
				? (
					<div class="ntf-page__listhead">
						<Checkbox
							label={chosen.size > 0 ? `${chosen.size} selected` : "Select all"}
							value={allTicked}
							indeterminate={chosen.size > 0 && !allChosen}
							onValueChange={(on) =>
								selected.value = on ? new Set(items.map((i) => i.id)) : new Set()}
						/>
					</div>
				)
				: null}

			<section class="ntf-panel" aria-label={panelLabel(current)}>
				<NotificationList
					feed={feed}
					now={Date.now()}
					emptyTitle={empty.title}
					emptyDescription={empty.description}
					archivable={selectable}
					selected={selectable ? chosen : undefined}
					onSelect={selectable ? toggle : undefined}
				/>
			</section>
		</div>
	);
}
