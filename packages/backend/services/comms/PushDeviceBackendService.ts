import type { SupabaseClient } from "supabaseClient";
import type {
	PushConfig,
	PushDeviceStatus,
	RevokeWebPush,
	WebPushSubscription,
} from "@projective/types/comms";
import { fail, ok, type ServiceResult } from "../ServiceResult.ts";
import { getUserClient, isAuthBackendLive } from "../../core/supabase.ts";
import { canReadLive, type ReadActor } from "../read-actor.ts";
import { isPushEndpoint, vapidConfig } from "./transport-webpush.ts";

/**
 * PushDeviceBackendService — this browser's Web Push subscription (COMMS NT4; providers spec §8.2),
 * behind `GET /api/notifications/push/config`, `POST`/`DELETE /api/notifications/devices` and
 * `POST /api/notifications/devices/status`.
 *
 * Registration and revocation run under the CALLER's JWT through `comms.register_device` and
 * `comms.revoke_device`, so nobody can register or revoke a device for someone else. A browser
 * belongs to the account that last turned alerts on in it: `register_device` (a definer for that
 * one step) releases another account's live row for the same endpoint, and Settings reads "on" only
 * for the caller's own live row ({@link PushDeviceBackendService.status}). The endpoint is accepted only from a known push service over https
 * (`isPushEndpoint`), the same check the transport repeats before every send: a browser supplies it,
 * and the dispatcher later POSTs to it. Nothing here works while push is not configured (VAPID): the
 * config read is a 404, and the Settings control does not render.
 */

const NOT_CONFIGURED = "Alerts on this device aren't available here.";

const commsDb = (token: string) =>
	getUserClient(token).schema("comms") as unknown as SupabaseClient;

/** The caller's token, or the refusal that stops them. */
function sessionToken(actor: ReadActor): string | ServiceResult<never> {
	if (!actor.userId) return fail(401, { message: "Sign in to get alerts on this device." });
	if (!isAuthBackendLive()) {
		return fail(503, { message: "Alerts on this device aren't connected in this environment." });
	}
	if (!canReadLive(actor)) {
		return fail(401, { message: "Your session has expired. Please sign in again." });
	}
	return actor.accessToken;
}

export class PushDeviceBackendService {
	/** The public key a browser subscribes with, or a 404 while VAPID is not configured. */
	static config(): ServiceResult<PushConfig> {
		const config = vapidConfig();
		return config
			? ok({ publicKey: config.publicKeyText })
			: fail(404, { message: NOT_CONFIGURED });
	}

	/** Register (or refresh) this browser's subscription for the caller. */
	static async register(
		actor: ReadActor,
		input: WebPushSubscription,
		userAgent: string | null,
	): Promise<ServiceResult<{ deviceId: string }>> {
		if (!vapidConfig()) return fail(404, { message: NOT_CONFIGURED });
		if (!isPushEndpoint(input.endpoint)) {
			return fail(422, {
				message: "This browser's push service isn't one Projective sends to.",
				errors: { endpoint: "Not a supported push service." },
			});
		}
		const token = sessionToken(actor);
		if (typeof token !== "string") return token;
		try {
			const { data, error } = await commsDb(token).rpc("register_device", {
				p_token: input.endpoint,
				p_platform: "web",
				p_provider: "web_push",
				p_endpoint: input.endpoint,
				p_p256dh: input.keys.p256dh,
				p_auth_key: input.keys.auth,
				p_label: input.label ?? null,
				p_user_agent: userAgent?.slice(0, 400) ?? null,
			});
			if (error || typeof data !== "string") {
				throw new Error(`comms.register_device failed (${error?.code ?? "no id"})`);
			}
			return ok({ deviceId: data }, { status: 201, message: "Alerts are on for this device." });
		} catch (error) {
			console.error("[comms:devices]", error instanceof Error ? error.message : error);
			return fail(503, {
				message: "Alerts couldn't be turned on just now. Try again in a moment.",
			});
		}
	}

	/**
	 * Is the browser holding `endpoint` the caller's own live device? False for a browser another
	 * account turned on, or one released since, so the control offers "Turn on alerts" there.
	 */
	static async status(
		actor: ReadActor,
		input: RevokeWebPush,
	): Promise<ServiceResult<PushDeviceStatus>> {
		const token = sessionToken(actor);
		if (typeof token !== "string") return token;
		try {
			const { data, error } = await commsDb(token)
				.from("device_tokens")
				.select("id")
				.eq("token", input.endpoint)
				.is("revoked_at", null)
				.limit(1);
			if (error) throw new Error(`device_tokens read failed (${error.code ?? "no code"})`);
			return ok({ live: (data ?? []).length > 0 });
		} catch (error) {
			console.error("[comms:devices]", error instanceof Error ? error.message : error);
			return fail(503, { message: "This device's alerts couldn't be checked just now." });
		}
	}

	/** Stop alerts on the browser holding `endpoint`. Idempotent: an unknown endpoint revokes nothing. */
	static async revoke(
		actor: ReadActor,
		input: RevokeWebPush,
	): Promise<ServiceResult<{ revoked: boolean }>> {
		const token = sessionToken(actor);
		if (typeof token !== "string") return token;
		try {
			const db = commsDb(token);
			const { data: rows, error } = await db
				.from("device_tokens")
				.select("id")
				.eq("token", input.endpoint)
				.is("revoked_at", null)
				.limit(5);
			if (error) throw new Error(`device_tokens read failed (${error.code ?? "no code"})`);
			let revoked = false;
			for (const row of (rows ?? []) as { id: string }[]) {
				const res = await db.rpc("revoke_device", { p_id: row.id, p_reason: "user_revoked" });
				if (res.error) {
					throw new Error(`comms.revoke_device failed (${res.error.code ?? "no code"})`);
				}
				revoked = revoked || res.data === true;
			}
			return ok({ revoked }, { message: "Alerts are off for this device." });
		} catch (error) {
			console.error("[comms:devices]", error instanceof Error ? error.message : error);
			return fail(503, {
				message: "Alerts couldn't be turned off just now. Try again in a moment.",
			});
		}
	}
}
