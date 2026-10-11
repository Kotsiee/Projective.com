import type { JSX } from "preact";
import { type Signal, useSignal } from "@preact/signals";
import { useEffect } from "preact/hooks";
import "../styles/notifications.css";
import { Drawer } from "@projective/ui/feedback";
import { Button } from "@projective/ui/fields";
import {
	emptyCopy,
	type InboxTab,
	type InboxView,
	TAB_LABEL,
	tabUnread,
} from "../core/notification-model.ts";
import { inboxSummary, startInboxPolling } from "../core/notification-state.ts";
import { useNotificationFeed } from "../core/useNotificationFeed.ts";
import { NotificationTabs } from "../components/NotificationTabs.tsx";
import { NotificationList } from "../components/NotificationList.tsx";

/** Props for {@link NotificationDrawer}. */
export interface NotificationDrawerProps {
	/** Open state, owned by the header's Notifications control. */
	open: Signal<boolean>;
}

const PANEL_ID = "ntf-drawer-panel";

/**
 * NotificationDrawer — the header's notification drawer (DESIGN_SYSTEM §D.9), a right `Drawer` over
 * the real inbox: the category tabs with their unread counts, "Mark all as read" scoped to the open
 * tab, the rows (each a link that marks itself read; per-row archive), and "View all notifications" in
 * the pinned footer. Mounted unconditionally by `UserActions` because it also runs the shell's ONE
 * `/summary` poller, which the header dot reads; the list itself reads only while the drawer is open,
 * and opening it marks the inbox seen.
 */
export default function NotificationDrawer({ open }: NotificationDrawerProps): JSX.Element {
	const tab = useSignal<InboxTab>("all");
	const view = useSignal<InboxView>("all");
	const feed = useNotificationFeed({ tab, view, active: open, pageSize: 15 });
	useEffect(() => startInboxPolling(), []);

	const close = () => (open.value = false);
	const unread = tabUnread(inboxSummary.value, tab.value);
	const empty = emptyCopy(tab.value, "all");

	return (
		<Drawer
			visible={open}
			position="right"
			header="Notifications"
			class="shell-drawer ntf-drawer"
			footer={
				<a class="ntf-footer-link" href="/notifications" onClick={close}>View all notifications</a>
			}
		>
			<div class="ntf-drawer__head">
				<NotificationTabs tab={tab} panelId={PANEL_ID} class="ntf-tabs" />
				<div class="ntf-toolbar">
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
				</div>
			</div>
			<div
				class="ntf-panel"
				role="tabpanel"
				id={PANEL_ID}
				aria-label={`${TAB_LABEL[tab.value]} notifications`}
			>
				<NotificationList
					feed={feed}
					now={Date.now()}
					emptyTitle={empty.title}
					emptyDescription={empty.description}
					archivable
					onNavigate={close}
				/>
			</div>
		</Drawer>
	);
}
