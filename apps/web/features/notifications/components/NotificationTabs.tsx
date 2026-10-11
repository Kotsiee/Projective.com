import type { JSX } from "preact";
import type { Signal } from "@preact/signals";
import { TabMenu } from "@projective/ui/navigation";
import { INBOX_TABS, type InboxTab, TAB_LABEL, tabUnread } from "../core/notification-model.ts";
import { inboxSummary } from "../core/notification-state.ts";

/** Props for {@link NotificationTabs}. */
export interface NotificationTabsProps {
	tab: Signal<InboxTab>;
	/** The id of the `role="tabpanel"` the caller renders under the strip. */
	panelId: string;
	class?: string;
}

/**
 * NotificationTabs — the category strip (DESIGN_SYSTEM §D.9): All · Money · Work · Messages · Schedule
 * · Discovery · Account · System, as a `TabMenu` in tablist mode (roving tabindex, arrows auto-activate,
 * `aria-controls` → the panel). A tab with unread rows carries its count — the ONE container the inbox
 * allows (§B.11: counts) — read from the shared `/summary`, and its accessible name says it in words.
 */
export function NotificationTabs(
	{ tab, panelId, class: className }: NotificationTabsProps,
): JSX.Element {
	const summary = inboxSummary.value;
	return (
		<TabMenu
			class={className}
			aria-label="Notification categories"
			panelId={panelId}
			activeIndex={INBOX_TABS.indexOf(tab.value)}
			onActiveIndexChange={(i) => (tab.value = INBOX_TABS[i])}
			model={INBOX_TABS.map((t) => {
				const n = tabUnread(summary, t);
				return { key: t, label: TAB_LABEL[t], badge: n > 0 ? (n > 99 ? "99+" : n) : undefined };
			})}
			itemTemplate={(item) => {
				const t = item.key as InboxTab;
				const n = tabUnread(summary, t);
				return (
					<>
						<span class="ui-tabmenu__label">{item.label}</span>
						{item.badge != null
							? (
								<span class="ui-tabmenu__badge">
									<span aria-hidden="true">{item.badge}</span>
									<span class="ui-visually-hidden">, {n} unread</span>
								</span>
							)
							: null}
					</>
				);
			}}
		/>
	);
}
