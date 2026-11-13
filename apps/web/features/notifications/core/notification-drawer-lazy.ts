import { lazyComponent } from "@web/utils/lazy-component.ts";
import type { NotificationDrawerPanelProps } from "../components/NotificationDrawerPanel.tsx";

/** The header drawer's feed UI, in its own chunk: fetched on intent or on first open. */
export const notificationDrawerPanel = lazyComponent<NotificationDrawerPanelProps>(
	"the notifications drawer",
	() => import("../components/NotificationDrawerPanel.tsx").then((m) => m.NotificationDrawerPanel),
);

/** Start fetching the drawer — the header trigger calls it on hover and focus. */
export function preloadNotificationDrawer(): void {
	void notificationDrawerPanel.load();
}
