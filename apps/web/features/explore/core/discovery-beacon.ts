import type { DiscoveryEventBatch } from "@projective/types/explore";
import { logger } from "@web/utils/logger.ts";
import { readStored, SessionKeys, writeStored } from "@web/utils/storage-keys.ts";
import { DISCOVERY_EVENTS_URL } from "./discovery-telemetry.ts";

/**
 * discovery-beacon — the browser half of discovery telemetry's transport, shared by the
 * `ImpressionTracker` (discovery surfaces) and the `ListingViewBeacon` (a listing's own page).
 * Browser-only: both are called from an island's effect, never during SSR.
 */

/**
 * This tab's anonymous key (`search.interest_events.session_id`): `sessionStorage`, so it lives as
 * long as the tab and is never shared between tabs or sent anywhere but the events route.
 */
export function discoverySessionId(): string {
	const stored = readStored("session", SessionKeys.DISCOVERY_SESSION);
	if (stored) return stored;
	const fresh = crypto.randomUUID();
	writeStored("session", SessionKeys.DISCOVERY_SESSION, fresh);
	return fresh;
}

/**
 * Send one batch to `POST /api/explore/events` with `navigator.sendBeacon` (same-origin, so the
 * session cookie rides along), falling back to a keep-alive `fetch` the offline guard never blocks.
 * Fire-and-forget: the route's answer is for logs, and a failure is only warned about.
 */
export function sendDiscoveryBatch(body: DiscoveryEventBatch): void {
	const json = JSON.stringify(body);
	if (
		navigator.sendBeacon?.(DISCOVERY_EVENTS_URL, new Blob([json], { type: "application/json" }))
	) {
		return;
	}
	fetch(DISCOVERY_EVENTS_URL, {
		method: "POST",
		body: json,
		keepalive: true,
		headers: { "content-type": "application/json", "x-pj-background": "1" },
	}).catch((error: unknown) =>
		logger.warn("Discovery telemetry could not be sent", {
			events: body.events.length,
			reason: error instanceof Error ? error.message : String(error),
		})
	);
}
