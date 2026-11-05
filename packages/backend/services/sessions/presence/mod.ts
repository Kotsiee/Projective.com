import type { PresenceAdapter } from "./adapter.ts";
import { googleCalendarPush, graphCalendarPush } from "./calendar-push.ts";
import { zoomPresence } from "./zoom.ts";

/** Every provider whose webhook is accepted, by its route segment. */
export const PRESENCE_ADAPTERS: Readonly<Record<string, PresenceAdapter>> = {
	zoom: zoomPresence,
	google: googleCalendarPush,
	outlook: graphCalendarPush,
};

export type { PresenceAdapter } from "./adapter.ts";
