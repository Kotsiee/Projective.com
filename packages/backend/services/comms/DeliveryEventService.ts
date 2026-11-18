import type { SupabaseClient } from "supabaseClient";
import { z } from "zod";
import {
	type DeliveryEventOutcome,
	DeliveryEventOutcome as OutcomeSchema,
} from "@projective/types/comms";
import { fail, ok, type ServiceResult } from "../ServiceResult.ts";
import { serverEnv } from "../../core/env.ts";
import { getServiceClient, isAuthBackendLive } from "../../core/supabase.ts";
import { applyNewsletterProviderEvent } from "../newsletter/provider-events.ts";

/**
 * DeliveryEventService — the email provider's delivery webhook, `POST /api/comms/webhooks/resend`
 * (COMMS NT3; providers spec §8.5 setup 6; the inbound standard of EPI §3.3).
 *
 * Resend signs with Svix: an HMAC-SHA256 over `${svix-id}.${svix-timestamp}.${body}` keyed with the
 * base64 secret after `whsec_` (`RESEND_WEBHOOK_SECRET`), checked in constant time against every
 * `v1,` signature in `svix-signature`, with a 300-second tolerance on the timestamp. Only then is the
 * body parsed, and one call to `comms.fn_record_delivery_event` claims `(resend, svix-id)` and applies
 * the effect in the same transaction: delivered, a hard bounce (the address suppressed for every
 * category and its owner told, Decision #339 ruling N3 (b)), a complaint (Marketing only), a failure,
 * or a plain record. A replay changes nothing.
 *
 * The same webhook carries the newsletter's share (CD1 step 5, Decision #480 Q1 A): Resend's contact
 * events and a spam complaint also go, once claimed, to `applyNewsletterProviderEvent`, which takes
 * the address off the newsletter or a topic off the address (one endpoint, one Svix secret). It runs
 * on a replay too, since its door is idempotent and a first delivery may have been claimed before the
 * newsletter's write failed.
 *
 * 2xx for handled, replayed and ignored events; 400 for a forged, stale or unreadable delivery (and
 * for every delivery while the secret is not configured, rather than trust an unsigned one); 503 only
 * to ask for a redelivery when the database could not take it. Logs carry the event id and type only.
 */

// #region Signature
/** The window a signed timestamp may sit in, either side of now (EPI §3.3). */
export const SVIX_TOLERANCE_SECONDS = 300;

/** Why a delivery's signature did or did not hold. */
export type SignatureCheck = "ok" | "unconfigured" | "missing" | "stale" | "forged";

/** Bytes Web Crypto accepts (an `ArrayBuffer`-backed view). */
type Bytes = Uint8Array<ArrayBuffer>;

function base64ToBytes(text: string): Bytes | null {
	try {
		const binary = atob(text);
		return Uint8Array.from(binary, (c) => c.charCodeAt(0));
	} catch {
		return null;
	}
}

function bytesToBase64(bytes: Bytes): string {
	let binary = "";
	for (const b of bytes) binary += String.fromCharCode(b);
	return btoa(binary);
}

function constantTimeEqual(a: string, b: string): boolean {
	const x = new TextEncoder().encode(a);
	const y = new TextEncoder().encode(b);
	if (x.length !== y.length) return false;
	let diff = 0;
	for (let i = 0; i < x.length; i++) diff |= x[i] ^ y[i];
	return diff === 0;
}

/** The HMAC key inside a `whsec_…` secret, or null when the secret is absent or not one. */
function svixKey(secret: string | undefined): Bytes | null {
	const trimmed = secret?.trim() ?? "";
	if (!trimmed.startsWith("whsec_")) return null;
	const key = base64ToBytes(trimmed.slice("whsec_".length));
	return key && key.length >= 16 ? key : null;
}

/**
 * Verify a Svix-signed delivery over its RAW body. `nowMs` is injectable for tests. Nothing about the
 * body is trusted, or even parsed, before this answers `ok`.
 */
export async function verifySvixSignature(
	raw: string,
	headers: Headers,
	secret: string | undefined,
	nowMs: number = Date.now(),
): Promise<SignatureCheck> {
	const key = svixKey(secret);
	if (!key) return "unconfigured";
	const id = headers.get("svix-id")?.trim() ?? "";
	const timestamp = headers.get("svix-timestamp")?.trim() ?? "";
	const signatures = headers.get("svix-signature")?.trim() ?? "";
	if (!id || !/^\d{1,12}$/.test(timestamp) || !signatures) return "missing";
	if (Math.abs(nowMs / 1000 - Number(timestamp)) > SVIX_TOLERANCE_SECONDS) return "stale";

	const cryptoKey = await crypto.subtle.importKey(
		"raw",
		key,
		{ name: "HMAC", hash: "SHA-256" },
		false,
		[
			"sign",
		],
	);
	const signed = new Uint8Array(
		await crypto.subtle.sign(
			"HMAC",
			cryptoKey,
			new TextEncoder().encode(`${id}.${timestamp}.${raw}`),
		),
	);
	const expected = bytesToBase64(signed);
	const candidates = signatures.split(" ").map((s) => s.trim()).filter((s) => s.startsWith("v1,"));
	let match = false;
	for (const candidate of candidates) {
		match = constantTimeEqual(candidate.slice(3), expected) || match;
	}
	return match ? "ok" : "forged";
}
// #endregion

// #region Event
/** The fields of a Resend email event this service reads; the rest of the payload is ignored. */
const ResendEventSchema = z.object({
	type: z.string().min(1).max(64),
	created_at: z.string().max(64).optional(),
	data: z.object({
		email_id: z.string().max(128).optional(),
		to: z.union([z.array(z.string().max(320)), z.string().max(320)]).optional(),
		bounce: z.object({ type: z.string().max(64).optional() }).passthrough().optional(),
	}).passthrough(),
}).passthrough();

/** The arguments of `comms.fn_record_delivery_event` for one parsed event. */
export function eventArgs(eventId: string, raw: unknown): Record<string, string | null> | null {
	const parsed = ResendEventSchema.safeParse(raw);
	if (!parsed.success) return null;
	const { type, created_at: createdAt, data } = parsed.data;
	const recipient = Array.isArray(data.to) ? data.to[0] ?? null : data.to ?? null;
	const occurred = createdAt && !Number.isNaN(Date.parse(createdAt))
		? new Date(createdAt).toISOString()
		: null;
	return {
		p_provider: "resend",
		p_provider_event_id: eventId,
		p_event_type: type,
		p_provider_ref: data.email_id ?? null,
		p_recipient: recipient,
		p_bounce_kind: data.bounce?.type ?? null,
		p_occurred_at: occurred,
	};
}
// #endregion

// #region Service
/** The database half, behind a seam for tests. */
export type RecordEvent = (args: Record<string, string | null>) => Promise<DeliveryEventOutcome>;

const recordLive: RecordEvent = async (args) => {
	const db = getServiceClient().schema("comms") as unknown as SupabaseClient;
	const { data, error } = await db.rpc("fn_record_delivery_event", args);
	if (error) throw new Error(`comms.fn_record_delivery_event failed (${error.code ?? "no code"})`);
	const outcome = OutcomeSchema.safeParse(data);
	if (!outcome.success) {
		throw new Error("comms.fn_record_delivery_event answered an unknown outcome");
	}
	return outcome.data;
};

/** What the route answers with. */
export interface WebhookReceipt {
	received: true;
	outcome: DeliveryEventOutcome;
}

export interface DeliveryEventDeps {
	live: boolean;
	secret: string | undefined;
	record: RecordEvent;
	/** The newsletter's share of a claimed event; throws when it could not be applied. */
	newsletter: (eventId: string, body: unknown) => Promise<unknown>;
	nowMs: number;
}

const liveDeps = (): DeliveryEventDeps => ({
	live: isAuthBackendLive(),
	secret: serverEnv().resendWebhookSecret,
	record: recordLive,
	newsletter: (eventId, body) => applyNewsletterProviderEvent(eventId, body),
	nowMs: Date.now(),
});

export class DeliveryEventService {
	/** One Resend delivery: verify, parse, record (see the module doc for the status codes). */
	static async handleResend(
		raw: string,
		headers: Headers,
		deps: Partial<DeliveryEventDeps> = {},
	): Promise<ServiceResult<WebhookReceipt>> {
		const d = { ...liveDeps(), ...deps };
		const check = await verifySvixSignature(raw, headers, d.secret, d.nowMs);
		if (check !== "ok") {
			console.warn("[comms:resend] refused a delivery:", check);
			return fail(400, { message: "This webhook delivery couldn't be verified." });
		}
		const eventId = headers.get("svix-id")!.trim();
		let body: unknown;
		try {
			body = JSON.parse(raw);
		} catch {
			return fail(400, { message: "This webhook delivery isn't JSON." });
		}
		const args = eventArgs(eventId, body);
		if (!args) return fail(400, { message: "This webhook delivery isn't a Resend event." });
		if (!d.live) {
			return fail(503, { message: "Delivery events aren't connected in this environment." });
		}

		try {
			const outcome = await d.record(args);
			console.info("[comms:resend]", eventId, args.p_event_type, "→", outcome);
			await d.newsletter(eventId, body);
			return ok({ received: true, outcome });
		} catch (error) {
			console.error(
				"[comms:resend]",
				eventId,
				args.p_event_type,
				error instanceof Error ? error.message : error,
			);
			return fail(503, { message: "The event couldn't be recorded just now; send it again." });
		}
	}
}
// #endregion
