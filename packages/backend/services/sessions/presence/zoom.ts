import type { PresenceEvent } from "@projective/types/projects";
import { serverEnv } from "../../../core/env.ts";
import { hmacSha256Hex, type PresenceAdapter, timingSafeEqual, usableSecret } from "./adapter.ts";

/**
 * Zoom's presence adapter — `meeting.participant_joined` / `participant_left` /
 * `participant_jbh_waiting` from a Zoom app's Event Subscription (Decision #171). `participant.id` is
 * the account at Zoom, which stays the same for a host and is empty for a guest, so it is how a room
 * knows its host; a guest reaches a person through `registrant_id`, when they used a personal link.
 *
 * **Signature.** Every delivery carries `x-zm-request-timestamp` (seconds) and `x-zm-signature`
 * (`v0=` + hex HMAC-SHA256 of `v0:{timestamp}:{raw body}` under the subscription's Secret Token). A
 * delivery older than five minutes is refused, so a captured one cannot be replayed later.
 *
 * **The validation handshake is verified too, deliberately.** Zoom proves the endpoint by sending
 * `endpoint.url_validation` with a `plainToken` and expecting HMAC-SHA256(secret, plainToken) back —
 * the SAME key and the SAME algorithm that sign events. Answered for an unsigned request, that reply
 * is a signing oracle: a `plainToken` of `v0:{ts}:{forged body}` returns a valid signature for the
 * forgery. So the challenge is answered only on a delivery that already verified.
 */

/** Seconds a delivery may be old (or early, for clock skew) and still be accepted. */
const TOLERANCE_S = 300;

const HANDLED: Readonly<Record<string, PresenceEvent["action"]>> = {
	"meeting.participant_joined": "joined",
	"meeting.participant_left": "left",
	"meeting.participant_jbh_waiting": "waiting",
};

interface ZoomParticipant {
	user_id?: string | number;
	id?: string;
	participant_uuid?: string;
	registrant_id?: string;
	email?: string;
	join_time?: string;
	leave_time?: string;
}

interface ZoomBody {
	event?: string;
	event_ts?: number;
	payload?: {
		plainToken?: string;
		user_id?: string;
		object?: { id?: string | number; uuid?: string; participant?: ZoomParticipant };
	};
}

function asBody(body: unknown): ZoomBody | null {
	return body && typeof body === "object" ? body as ZoomBody : null;
}

/** An ISO instant from an ISO string or epoch milliseconds, or `null`. */
function instant(value: string | number | undefined): string | null {
	if (value === undefined || value === "") return null;
	const ms = typeof value === "number" ? value : Date.parse(value);
	return Number.isFinite(ms) ? new Date(ms).toISOString() : null;
}

export const zoomPresence: PresenceAdapter = {
	provider: "zoom",

	secret: () => usableSecret(serverEnv().zoomWebhookSecret),

	async verify(raw, headers, secret, nowMs) {
		const ts = headers.get("x-zm-request-timestamp") ?? "";
		const sig = headers.get("x-zm-signature") ?? "";
		const seconds = Number(ts);
		if (!/^\d{1,12}$/.test(ts) || !Number.isFinite(seconds)) return false;
		if (Math.abs(nowMs / 1000 - seconds) > TOLERANCE_S) return false;
		const expected = `v0=${await hmacSha256Hex(secret, `v0:${ts}:${raw}`)}`;
		return timingSafeEqual(sig, expected);
	},

	async challenge(body, secret) {
		const b = asBody(body);
		if (b?.event !== "endpoint.url_validation") return null;
		const plainToken = b.payload?.plainToken;
		if (typeof plainToken !== "string" || plainToken.length === 0 || plainToken.length > 200) return null;
		return { plainToken, encryptedToken: await hmacSha256Hex(secret, plainToken) };
	},

	// Marketplace review requires it: a person who removes the app must lose the connection here too.
	deauthorization(body) {
		const b = asBody(body);
		const userId = b?.payload?.user_id;
		if (b?.event !== "app_deauthorized" || !userId) return null;
		return {
			externalAccountId: userId,
			deliveryId: `app_deauthorized:${userId}:${b.event_ts ?? ""}`.slice(0, 200),
		};
	},

	parse(body) {
		const b = asBody(body);
		const action = b?.event ? HANDLED[b.event] : undefined;
		if (!b || !action) return [];
		const object = b.payload?.object;
		const p = object?.participant;
		const meetingId = object?.id === undefined ? "" : String(object.id).trim();
		if (!p || !meetingId) return [];
		const at = instant(action === "joined" ? p.join_time : action === "left" ? p.leave_time : undefined) ??
			instant(b.event_ts);
		if (!at) return [];
		const email = typeof p.email === "string" && p.email.trim() ? p.email.trim().slice(0, 320) : null;
		const who = p.participant_uuid ?? p.id ?? (p.user_id === undefined ? "" : String(p.user_id));
		return [{
			provider: "zoom",
			meetingId: meetingId.slice(0, 120),
			email,
			action,
			at,
			// The same participant joining twice is two events; a redelivery of one is the same id.
			providerEventId: `${b.event}:${object?.uuid ?? meetingId}:${who}:${b.event_ts ?? at}`.slice(0, 200),
			// `participant_uuid` can change on a rejoin, so anything steadier comes first.
			participantKey: (p.registrant_id || p.id || email || who || "unknown").slice(0, 320),
			registrantId: p.registrant_id?.slice(0, 120) || null,
			accountId: p.id?.slice(0, 120) || null,
		}];
	},
};
