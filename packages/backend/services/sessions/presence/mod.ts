import type { PresenceAdapter } from "./adapter.ts";
import { zoomPresence } from "./zoom.ts";

/** Every conferencing provider whose presence webhook is accepted, by its route segment. */
export const PRESENCE_ADAPTERS: Readonly<Record<string, PresenceAdapter>> = {
	zoom: zoomPresence,
};

export type { PresenceAdapter } from "./adapter.ts";
