import type { JSX } from "preact";
import { useSignal, useSignalEffect } from "@preact/signals";
import "../styles/notifications.css";
import type { NotificationInboxItem } from "@projective/types/comms";
import { Button, Checkbox, SelectButton } from "@projective/ui/fields";
import {
	emptyCopy,
	INBOX_VIEWS,
	inboxHref,
	type InboxTab,
	type InboxView,
	TAB_LABEL,
	tabUnread,
	VIEW_LABEL,
} from "../core/notification-model.ts";
import { inboxSummary } from "../core/notification-state.ts";
import { useNotificationFeed } from "../core/useNotificationFeed.ts";
import { NotificationTabs } from "../components/NotificationTabs.tsx";
import { NotificationList } from "../components/NotificationList.tsx";

/** Props for {@link NotificationsPage}. */
export interface NotificationsPageProps {
	/** The tab and view decoded from `?category=&view=`. */
	initialTab: InboxTab;
	initialView: InboxView;
}

const PANEL_ID = "ntf-page-panel";

/**
 * NotificationsPage — `/notifications` (DESIGN_SYSTEM §D.9): the drawer's tabs and rows at page scale,
 * plus the All · Unread · Archived views, keyset "Load more", bulk select (mark read · archive), and a
 * link to Settings → Notifications. The tab and view live in the URL (`?category=&view=`, replaced in
 * place so the address is always a deep link to what is on screen). Live arrivals come from the
 * header's shared `/summary` poller.
 */
export default function NotificationsPage(props: NotificationsPageProps): JSX.Element {
	const tab = useSignal<InboxTab>(props.initialTab);
	const view = useSignal<InboxView>(props.initialView);
	const active = useSignal(true);
	const feed = useNotificationFeed({ tab, view, active });
	const selected = useSignal<ReadonlySet<string>>(new Set());

	// Keep the address on what is shown, and drop a selection that belonged to another slice.
	useSignalEffect(() => {
		const href = inboxHref(tab.value, view.value);
		selected.value = new Set();
		if (globalThis.location && location.pathname + location.search !== href) {
			history.replaceState(history.state, "", href);
		}
	});

	// A selected row that left the list (archived, or a reload) is no longer selected.
	useSignalEffect(() => {
		const ids = new Set(feed.items.value.map((i) => i.id));
		const kept = [...selected.peek()].filter((id) => ids.has(id));
		if (kept.length !== selected.peek().size) selected.value = new Set(kept);
	});

	const items = feed.items.value;
	const chosen = selected.value;
	const archivedView = view.value === "archived";
	const unread = tabUnread(inboxSummary.value, tab.value);
	const empty = emptyCopy(tab.value, view.value);
	const allChosen = items.length > 0 && chosen.size === items.length;

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
			<header class="ntf-page__head">
				<h1 class="ntf-page__title">Notifications</h1>
				<a class="ntf-page__settings" href="/settings/notifications">Notification settings</a>
			</header>

			<NotificationTabs tab={tab} panelId={PANEL_ID} class="ntf-tabs" />

			<div class="ntf-page__bar">
				<SelectButton
					aria-label="Show"
					size="sm"
					options={INBOX_VIEWS.map((v) => ({ value: v, label: VIEW_LABEL[v] }))}
					value={view.value}
					onValueChange={(v) => (view.value = v as InboxView)}
				/>
				{archivedView ? null : (
					<div class="ntf-page__bulk">
						{items.length > 0
							? (
								<Checkbox
									label={chosen.size > 0 ? `${chosen.size} selected` : "Select all"}
									value={allChosen}
									indeterminate={chosen.size > 0 && !allChosen}
									onValueChange={(on) =>
										selected.value = on ? new Set(items.map((i) => i.id)) : new Set()}
								/>
							)
							: null}
						{chosen.size > 0
							? (
								<>
									<Button
										variant="text"
										size="sm"
										label="Mark read"
										onClick={() => bulk((ids) => feed.markRead(ids))}
									/>
									<Button
										variant="text"
										size="sm"
										label="Archive"
										onClick={() => bulk(feed.archive)}
									/>
								</>
							)
							: (
								<Button
									variant="text"
									size="sm"
									label="Mark all as read"
									aria-label={tab.value === "all"
										? "Mark all as read"
										: `Mark all ${TAB_LABEL[tab.value]} notifications as read`}
									disabled={unread === 0}
									onClick={() => void feed.markAllRead()}
								/>
							)}
					</div>
				)}
			</div>

			<div
				class="ntf-panel"
				role="tabpanel"
				id={PANEL_ID}
				aria-label={`${TAB_LABEL[tab.value]} notifications${
					view.value === "all" ? "" : `, ${VIEW_LABEL[view.value].toLowerCase()}`
				}`}
			>
				<NotificationList
					feed={feed}
					now={Date.now()}
					emptyTitle={empty.title}
					emptyDescription={empty.description}
					archivable={!archivedView}
					selected={archivedView ? undefined : chosen}
					onSelect={archivedView ? undefined : toggle}
				/>
			</div>
		</div>
	);
}
