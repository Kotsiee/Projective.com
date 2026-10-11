import type { PresenceEvent } from "@projective/types/projects";
import { serverEnv } from "../../../core/env.ts";
import { hmacSha256Hex, type PresenceAdapter, timingSafeEqual, usableSecret } from "./adapter.ts";

/**
 * Zoom's presence adapter — `meeting.participant_joined` / `meeting.participant_left` from a Zoom
 * app's Event Subscription (Decision #171).
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

const HANDLED = new Set(["meeting.participant_joined", "meeting.participant_left"]);

interface ZoomParticipant {
	user_id?: string | number;
	id?: string;
	participant_uuid?: string;
	email?: string;
	join_time?: string;
	leave_time?: string;
}

interface ZoomBody {
	event?: string;
	event_ts?: number;
	payload?: {
		plainToken?: string;
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

	parse(body) {
		const b = asBody(body);
		if (!b?.event || !HANDLED.has(b.event)) return [];
		const object = b.payload?.object;
		const p = object?.participant;
		const meetingId = object?.id === undefined ? "" : String(object.id).trim();
		if (!p || !meetingId) return [];
		const action: PresenceEvent["action"] = b.event === "meeting.participant_joined" ? "joined" : "left";
		const at = instant(action === "joined" ? p.join_time : p.leave_time) ?? instant(b.event_ts);
		if (!at) return [];
		const who = p.participant_uuid ?? p.id ?? (p.user_id === undefined ? "" : String(p.user_id));
		return [{
			provider: "zoom",
			meetingId: meetingId.slice(0, 120),
			email: typeof p.email === "string" && p.email.trim() ? p.email.trim().slice(0, 320) : null,
			action,
			at,
			// The same participant joining twice is two events; a redelivery of one is the same id.
			providerEventId: `${b.event}:${object?.uuid ?? meetingId}:${who}:${b.event_ts ?? at}`.slice(0, 200),
		}];
	},
};
