import { type PresenceAdapter, timingSafeEqual } from "./adapter.ts";

/**
 * The two calendar push providers. Neither signs a delivery, so each carries a per-channel secret
 * instead (providers spec §3.3, Decision #383 (e)): the adapter names the channel and the secret is
 * the `verification_token` on its `webhook_subscriptions` row.
 *
 * A push carries no event, only that something changed, so `parse` answers nothing: a verified push
 * marks its calendar due and `CalendarSyncBackendService` does the reading in its job.
 */

/** A Google Calendar push: an empty body, with the channel's own token in a header. */
export const googleCalendarPush: PresenceAdapter = {
	provider: "google",

	secret: () => undefined,

	channelOf: (_raw, headers) => headers.get("x-goog-channel-id"),

	verify: (_raw, headers, secret) =>
		Promise.resolve(timingSafeEqual(headers.get("x-goog-channel-token") ?? "", secret)),

	challenge: () => Promise.resolve(null),

	parse: () => [],
};

interface GraphNotification {
	subscriptionId?: string;
	clientState?: string;
	/** On a lifecycle notification: `reauthorizationRequired`, `subscriptionRemoved` or `missed`. */
	lifecycleEvent?: string;
}

function notificationsOf(raw: string): GraphNotification[] {
	try {
		const value = (JSON.parse(raw) as { value?: GraphNotification[] } | null)?.value;
		return Array.isArray(value) ? value : [];
	} catch {
		return [];
	}
}

/** A Graph change notification: the subscription's `clientState` travels in the body. */
export const graphCalendarPush: PresenceAdapter = {
	provider: "outlook",

	secret: () => undefined,

	channelOf: (raw) => notificationsOf(raw)[0]?.subscriptionId ?? null,

	split: (raw) =>
		[...Map.groupBy(notificationsOf(raw), (n) => n.subscriptionId).values()]
			.map((value) => JSON.stringify({ value })),

	verify(raw, _headers, secret) {
		const notifications = notificationsOf(raw);
		return Promise.resolve(
			notifications.length > 0 &&
				notifications.every((n) => timingSafeEqual(n.clientState ?? "", secret)),
		);
	},

	// `missed` only means changes went unannounced, and the read that a push marks due covers those.
	lapsed: (raw) =>
		notificationsOf(raw).some((n) => n.lifecycleEvent && n.lifecycleEvent !== "missed"),

	handshake: (url) => url.searchParams.get("validationToken"),

	challenge: () => Promise.resolve(null),

	parse: () => [],
};
