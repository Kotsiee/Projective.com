import type { JSX } from "preact";
import { type Signal, useComputed, useSignal } from "@preact/signals";
import { Drawer } from "@projective/ui/feedback";
import { Button, Select, SelectButton } from "@projective/ui/fields";
import {
	DRAWER_VIEWS,
	emptyCopy,
	inboxHref,
	type InboxView,
	parseTab,
	TAB_LABEL,
	tabUnread,
	VIEW_LABEL,
} from "../core/notification-model.ts";
import { inboxSummary } from "../core/notification-state.ts";
import { categoryOptions } from "../core/category-options.ts";
import { useNotificationFeed } from "../core/useNotificationFeed.ts";
import { NotificationList } from "./NotificationList.tsx";

/** Props for {@link NotificationDrawerPanel}. */
export interface NotificationDrawerPanelProps {
	/** Open state, owned by the header's Notifications control. */
	open: Signal<boolean>;
}

/**
 * NotificationDrawerPanel — the header's notification drawer (DESIGN_SYSTEM §D.9.1), a right `Drawer`
 * over the real inbox: one utility row under the title — the category `Select` (each option with its
 * unread figure), the All · Unread switch and "Mark all as read" scoped to the category — then the rows
 * (each a link that marks itself read; per-row archive), and "View all notifications" in the pinned
 * footer, opening the page on the same slice. Loaded lazily by `NotificationDrawer`; the list reads
 * only while the drawer is open, and opening it marks the inbox seen.
 */
export function NotificationDrawerPanel({ open }: NotificationDrawerPanelProps): JSX.Element {
	const category = useSignal<string>("all");
	const tab = useComputed(() => parseTab(category.value));
	const view = useSignal<InboxView>("all");
	const feed = useNotificationFeed({ tab, view, active: open, pageSize: 15 });

	const close = () => (open.value = false);
	const summary = inboxSummary.value;
	const unread = tabUnread(summary, tab.value);
	const empty = emptyCopy(tab.value, view.value);
	const scope = tab.value === "all" ? "All notifications" : `${TAB_LABEL[tab.value]} notifications`;

	return (
		<Drawer
			visible={open}
			position="right"
			header="Notifications"
			class="shell-drawer ntf-drawer"
			footer={
				<a
					class="ui-button ui-button--neutral ui-button--outlined ui-button--size-md ui-button--fluid ntf-drawer__all"
					href={inboxHref(tab.value, view.value)}
					onClick={close}
				>
					<span class="ui-button__label">View all notifications</span>
				</a>
			}
		>
			<div class="ntf-drawer__bar" role="group" aria-label="Filter notifications">
				<Select
					class="ntf-drawer__category"
					size="sm"
					panelWidth="auto"
					aria-label="Category"
					options={categoryOptions(summary)}
					value={category}
				/>
				<SelectButton
					aria-label="Show"
					size="sm"
					options={DRAWER_VIEWS.map((v) => ({ value: v, label: VIEW_LABEL[v] }))}
					value={view.value}
					onValueChange={(v) => (view.value = v as InboxView)}
				/>
				<Button
					class="ntf-drawer__markall"
					variant="text"
					size="sm"
					label="Mark all as read"
					aria-label={tab.value === "all"
						? "Mark all as read"
						: `Mark all ${TAB_LABEL[tab.value]} notifications as read`}
					aria-disabled={unread === 0 ? "true" : undefined}
					onClick={() => {
						if (unread > 0) void feed.markAllRead();
					}}
				/>
			</div>
			<section
				class="ntf-panel"
				aria-label={view.value === "unread" ? `${scope}, unread` : scope}
			>
				<NotificationList
					feed={feed}
					now={Date.now()}
					emptyTitle={empty.title}
					emptyDescription={empty.description}
					archivable
					onNavigate={close}
				/>
			</section>
		</Drawer>
	);
}
