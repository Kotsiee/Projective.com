/**
 * channels — a provider's push channel on a calendar (providers spec §7.3, §7.4): opening one when
 * calendar sync finds none, keeping it alive, and stopping it on disconnect.
 *
 * Google's channels cannot be extended: a new one takes over and the old is stopped. Graph's
 * subscriptions extend in place, and Graph caps the lifetime per resource, so what it answers is what
 * is stored.
 *
 * Graph documents event subscriptions on `/me/events` only, which also covers the Projective calendar.
 * So a write to that calendar can push here: it only marks a read of the primary calendar due, and the
 * read finds nothing.
 */

const TIMEOUT_MS = 15_000;
const GOOGLE_API = "https://www.googleapis.com/calendar/v3";
const GRAPH_API = "https://graph.microsoft.com/v1.0";
const GRAPH_LIFETIME_MS = 2 * 24 * 60 * 60 * 1000;

/** The `integrations.webhook_subscriptions` columns a renewal reads. */
export interface ChannelRow {
	id: string;
	connection_id: string;
	provider_slug: string;
	/** `calendar:<calendar id>`. */
	resource: string;
	external_channel_id: string | null;
	external_resource_id: string | null;
	verification_token: string | null;
	callback_url: string | null;
}

/** What a renewal leaves on the row. */
export interface RenewedChannel {
	expiresAt: string;
	externalChannelId: string | null;
	externalResourceId: string | null;
}

/** One JSON call to a calendar provider, on the connection's access token. */
export function providerCall(
	url: string,
	accessToken: string,
	method: string,
	body?: unknown,
	headers?: Record<string, string>,
) {
	return fetch(url, {
		method,
		headers: {
			authorization: `Bearer ${accessToken}`,
			"content-type": "application/json",
			...headers,
		},
		body: JSON.stringify(body),
		signal: AbortSignal.timeout(TIMEOUT_MS),
	});
}

/** What opening a channel needs, a new row's values or the row a renewal replaces. */
type ChannelTarget = Pick<ChannelRow, "resource" | "callback_url" | "verification_token">;

async function openGoogle(channel: ChannelTarget, accessToken: string): Promise<RenewedChannel> {
	const calendarId = encodeURIComponent(channel.resource.replace(/^calendar:/, ""));
	const res = await providerCall(
		`${GOOGLE_API}/calendars/${calendarId}/events/watch`,
		accessToken,
		"POST",
		{
			id: crypto.randomUUID(),
			type: "web_hook",
			address: channel.callback_url,
			token: channel.verification_token,
		},
	);
	if (!res.ok) {
		await res.body?.cancel();
		throw new Error(`google answered ${res.status} opening a channel`);
	}
	const created = await res.json() as { id: string; resourceId: string; expiration: string };
	return {
		expiresAt: new Date(Number(created.expiration)).toISOString(),
		externalChannelId: created.id,
		externalResourceId: created.resourceId,
	};
}

async function openGraph(channel: ChannelTarget, accessToken: string): Promise<RenewedChannel> {
	const res = await providerCall(`${GRAPH_API}/subscriptions`, accessToken, "POST", {
		changeType: "created,updated,deleted",
		notificationUrl: channel.callback_url,
		lifecycleNotificationUrl: channel.callback_url,
		resource: "/me/events",
		expirationDateTime: new Date(Date.now() + GRAPH_LIFETIME_MS).toISOString(),
		clientState: channel.verification_token,
	});
	if (!res.ok) {
		await res.body?.cancel();
		throw new Error(`outlook answered ${res.status} opening a subscription`);
	}
	const created = await res.json() as { id: string; expirationDateTime: string };
	return {
		expiresAt: new Date(created.expirationDateTime).toISOString(),
		externalChannelId: created.id,
		externalResourceId: null,
	};
}

/** Open a push channel on one calendar. Throws on a refusal. */
export function openChannel(
	providerSlug: string,
	channel: ChannelTarget,
	accessToken: string,
): Promise<RenewedChannel> {
	return providerSlug === "google"
		? openGoogle(channel, accessToken)
		: openGraph(channel, accessToken);
}

/**
 * Stop a channel at its provider, best effort: it never throws, because one left running only lapses,
 * and its pushes match no row by then.
 */
export async function stopChannel(
	channel: Pick<ChannelRow, "provider_slug" | "external_channel_id" | "external_resource_id">,
	accessToken: string,
): Promise<void> {
	const stop = channel.provider_slug === "google"
		? providerCall(`${GOOGLE_API}/channels/stop`, accessToken, "POST", {
			id: channel.external_channel_id,
			resourceId: channel.external_resource_id,
		})
		: providerCall(
			`${GRAPH_API}/subscriptions/${encodeURIComponent(channel.external_channel_id ?? "")}`,
			accessToken,
			"DELETE",
		);
	await stop.then((res) => res.body?.cancel()).catch(() => undefined);
}

async function renewGoogle(channel: ChannelRow, accessToken: string): Promise<RenewedChannel> {
	const opened = await openGoogle(channel, accessToken);
	await stopChannel(channel, accessToken);
	return opened;
}

async function renewGraph(channel: ChannelRow, accessToken: string): Promise<RenewedChannel> {
	const res = await providerCall(
		`${GRAPH_API}/subscriptions/${encodeURIComponent(channel.external_channel_id ?? "")}`,
		accessToken,
		"PATCH",
		{ expirationDateTime: new Date(Date.now() + GRAPH_LIFETIME_MS).toISOString() },
	);
	// Graph dropped it (`subscriptionRemoved`): there is nothing to extend, so open one on the same row.
	if (res.status === 404) {
		await res.body?.cancel();
		return openGraph(channel, accessToken);
	}
	if (!res.ok) {
		await res.body?.cancel();
		throw new Error(`outlook answered ${res.status} renewing a subscription`);
	}
	const renewed = await res.json() as { expirationDateTime: string };
	return {
		expiresAt: new Date(renewed.expirationDateTime).toISOString(),
		externalChannelId: channel.external_channel_id,
		externalResourceId: channel.external_resource_id,
	};
}

/** Renew one channel at its provider. Throws on a refusal, and the caller counts the failure. */
export function renewChannel(channel: ChannelRow, accessToken: string): Promise<RenewedChannel> {
	switch (channel.provider_slug) {
		case "google":
			return renewGoogle(channel, accessToken);
		case "outlook":
			return renewGraph(channel, accessToken);
		default:
			return Promise.reject(new Error(`${channel.provider_slug} has no renewable channels`));
	}
}
