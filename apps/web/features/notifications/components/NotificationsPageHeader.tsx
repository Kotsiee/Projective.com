import type { JSX } from "preact";
import { Button } from "@projective/ui/fields";
import { Icon } from "@projective/ui/icons";
import { openSettings } from "@web/features/settings/core/settings-bridge.ts";
import { type InboxTab, TAB_LABEL } from "../core/notification-model.ts";

/** Props for {@link NotificationsPageHeader}. */
export interface NotificationsPageHeaderProps {
	tab: InboxTab;
	/** Unread in the open category, or `null` before the first summary lands. */
	unread: number | null;
	/** Rows ticked for a bulk action; `0` offers Mark all as read instead. */
	selectedCount: number;
	/** Whether the view can be marked read at all (not the Archived view). */
	canMarkAll: boolean;
	onMarkAll: () => void;
	onMarkSelected: () => void;
	onArchiveSelected: () => void;
}

/**
 * NotificationsPageHeader — the `/notifications` title band (DESIGN_SYSTEM §D.9.2): the display-register
 * "Notifications" with the open category's unread figure inline in the Meta register, then the actions
 * — "Mark selected read" and "Archive selected" while rows are ticked, otherwise "Mark all as read"
 * (inert, not removed, when nothing is unread, so focus stays put) — and Notification settings, which
 * opens the contextual Settings modal on its Notifications section.
 */
export function NotificationsPageHeader(props: NotificationsPageHeaderProps): JSX.Element {
	const { tab, unread, selectedCount } = props;
	const scope = tab === "all" ? "" : ` in ${TAB_LABEL[tab]}`;
	const nothingUnread = unread === 0;

	return (
		<header class="ntf-page__head">
			<div class="ntf-page__titles">
				<h1 class="ntf-page__title">Notifications</h1>
				{unread !== null ? <p class="ntf-page__meta">{unread} unread{scope}</p> : null}
			</div>
			<div class="ntf-page__actions">
				{selectedCount > 0
					? (
						<>
							<Button
								severity="neutral"
								variant="outlined"
								size="sm"
								label="Mark selected read"
								aria-label={`Mark ${selectedCount} selected as read`}
								onClick={props.onMarkSelected}
							/>
							<Button
								severity="neutral"
								variant="outlined"
								size="sm"
								label="Archive selected"
								aria-label={`Archive ${selectedCount} selected`}
								onClick={props.onArchiveSelected}
							/>
						</>
					)
					: props.canMarkAll
					? (
						<Button
							severity="neutral"
							variant="outlined"
							size="sm"
							label="Mark all as read"
							aria-label={tab === "all"
								? "Mark all as read"
								: `Mark all ${TAB_LABEL[tab]} notifications as read`}
							aria-disabled={nothingUnread ? "true" : undefined}
							onClick={() => {
								if (!nothingUnread) props.onMarkAll();
							}}
						/>
					)
					: null}
				<Button
					variant="text"
					severity="secondary"
					size="sm"
					icon={<Icon name="settings" />}
					label="Notification settings"
					aria-haspopup="dialog"
					onClick={() => void openSettings("notifications")}
				/>
			</div>
		</header>
	);
}
