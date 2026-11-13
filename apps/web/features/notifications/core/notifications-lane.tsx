import type { ComponentChildren } from "preact";
import NotificationsLane from "../islands/NotificationsLane.island.tsx";
import { parseFilter } from "./notification-model.ts";

/**
 * The middle-nav lane on `/notifications`: the inbox's status views, categories and search
 * ({@link NotificationsLane}), seeded from the request's own `?category=&view=&q=`. Pure and
 * synchronous: the lane's figures come from the shell's `/summary` poller once hydrated, so the
 * resolver reads nothing. `null` on every other path.
 */
export function notificationsLaneFor(url: URL): ComponentChildren {
	if (url.pathname !== "/notifications" && url.pathname !== "/notifications/") return null;
	return <NotificationsLane filter={parseFilter(url.searchParams)} />;
}
