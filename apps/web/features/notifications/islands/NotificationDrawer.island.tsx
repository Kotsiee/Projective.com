import type { JSX } from "preact";
import { type Signal, useSignalEffect } from "@preact/signals";
import "../styles/notifications.css";
import { notificationDrawerPanel } from "../core/notification-drawer-lazy.ts";

/** Props for {@link NotificationDrawer}. */
export interface NotificationDrawerProps {
	/** Open state, owned by the header's Notifications control. */
	open: Signal<boolean>;
}

/**
 * NotificationDrawer — the header drawer's light host (DESIGN_SYSTEM §D.9.1). It ships with the shell
 * and holds only the stylesheet edge and a handle: the feed UI (`NotificationDrawerPanel`) arrives in
 * its own chunk on the trigger's hover or focus, or on first open, and opens as soon as it lands. If
 * that chunk cannot be fetched, the press still goes somewhere — the `/notifications` page. The
 * badge's `/summary` poller is not here: `UserActions` runs it, so the dot never waits on this chunk.
 */
export default function NotificationDrawer({ open }: NotificationDrawerProps): JSX.Element | null {
	useSignalEffect(() => {
		if (!open.value || notificationDrawerPanel.component.peek()) return;
		void notificationDrawerPanel.load().then((panel) => {
			if (panel || !open.peek()) return;
			open.value = false;
			globalThis.location.assign("/notifications");
		});
	});

	const Panel = notificationDrawerPanel.component.value;
	return Panel ? <Panel open={open} /> : null;
}
