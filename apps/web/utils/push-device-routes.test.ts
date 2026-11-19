import { assert, assertEquals } from "@std/assert";
import type { UserContext } from "@projective/types/auth";
import { handler as config } from "../routes/api/notifications/push/config.ts";
import { handler as devices } from "../routes/api/notifications/devices.ts";
import { handler as deviceStatus } from "../routes/api/notifications/devices/status.ts";
import { toB64Url } from "@server/services/comms/transport-webpush.ts";
import type { State } from "./state.ts";

/**
 * `GET /api/notifications/push/config` and `POST`/`DELETE /api/notifications/devices` (COMMS NT4):
 * with VAPID unconfigured the config read is a 404 and nothing registers; a body that is not a push
 * subscription, or an endpoint that is no push service, is refused before the database. The live
 * write (`comms.register_device` under the caller's JWT) is `supabase/probes/push_devices.sql`.
 */

// #region Harness
type Handler = (ctx: unknown) => Response | Promise<Response>;

const ORIGIN = "https://app.example.test";
const ALICE = { userId: "u-alice", contextType: "personal", contextId: "u-alice" } as UserContext;
const VAPID_NAMES = ["VAPID_PUBLIC_KEY", "VAPID_PRIVATE_KEY", "VAPID_SUBJECT"] as const;

function call(
	route: unknown,
	method: "GET" | "POST" | "DELETE",
	path: string,
	body?: unknown,
	state: State = { userContext: ALICE },
): Promise<Response> {
	const url = new URL(`${ORIGIN}${path}`);
	const req = new Request(url, {
		method,
		...(body === undefined
			? {}
			: { body: JSON.stringify(body), headers: { "content-type": "application/json" } }),
	});
	return Promise.resolve(
		(route as Record<string, Handler>)[method]({ req, url, params: {}, state }),
	);
}

/** Run `fn` with push configured (`on`) or not, restoring the environment afterwards. */
async function withVapid(
	on: boolean,
	fn: (publicKey: string | null) => Promise<void>,
): Promise<void> {
	const prior = VAPID_NAMES.map((name) => [name, Deno.env.get(name)] as const);
	try {
		if (on) {
			const pair = await crypto.subtle.generateKey({ name: "ECDSA", namedCurve: "P-256" }, true, [
				"sign",
				"verify",
			]);
			const publicKey = toB64Url(
				new Uint8Array(await crypto.subtle.exportKey("raw", pair.publicKey)),
			);
			Deno.env.set("VAPID_PUBLIC_KEY", publicKey);
			Deno.env.set("VAPID_PRIVATE_KEY", (await crypto.subtle.exportKey("jwk", pair.privateKey)).d!);
			Deno.env.set("VAPID_SUBJECT", "mailto:ops@example.test");
			await fn(publicKey);
		} else {
			VAPID_NAMES.forEach((name) => Deno.env.set(name, "XXXX-XXXX"));
			await fn(null);
		}
	} finally {
		prior.forEach(([name, value]) =>
			value === undefined ? Deno.env.delete(name) : Deno.env.set(name, value)
		);
	}
}

const SUBSCRIPTION = {
	endpoint: "https://fcm.googleapis.com/fcm/send/abc123",
	expirationTime: null,
	keys: { p256dh: "B".repeat(87), auth: "a".repeat(22) },
};
// #endregion

Deno.test("push config — 404 and no-store while VAPID is unconfigured; the public key once it is", async () => {
	await withVapid(false, async () => {
		const res = await call(config, "GET", "/api/notifications/push/config");
		assertEquals([res.status, res.headers.get("cache-control")], [404, "no-store"]);
	});
	await withVapid(true, async (publicKey) => {
		const res = await call(config, "GET", "/api/notifications/push/config");
		const body = await res.json();
		assertEquals([res.status, body.publicKey], [200, publicKey]);
	});
});

Deno.test("devices POST — unconfigured is a 404; a malformed body or a non-push endpoint is a 422", async () => {
	await withVapid(false, async () => {
		assertEquals(
			(await call(devices, "POST", "/api/notifications/devices", SUBSCRIPTION)).status,
			404,
		);
	});
	await withVapid(true, async () => {
		const malformed = await call(devices, "POST", "/api/notifications/devices", {
			endpoint: "nope",
		});
		assertEquals(malformed.status, 422);
		const elsewhere = await call(devices, "POST", "/api/notifications/devices", {
			...SUBSCRIPTION,
			endpoint: "https://evil.example/push",
		});
		const body = await elsewhere.json();
		assertEquals(elsewhere.status, 422);
		assert(typeof body.errors?.endpoint === "string");
	});
});

Deno.test("devices — a guest registers nothing; DELETE needs an endpoint", async () => {
	await withVapid(true, async () => {
		const guest = await call(devices, "POST", "/api/notifications/devices", SUBSCRIPTION, {});
		assertEquals(guest.status, 401);
		assertEquals((await call(devices, "DELETE", "/api/notifications/devices", {})).status, 422);
	});
});

Deno.test("devices/status — needs an endpoint in the body, and a guest has no device", async () => {
	assertEquals(
		(await call(deviceStatus, "POST", "/api/notifications/devices/status", {})).status,
		422,
	);
	const guest = await call(
		deviceStatus,
		"POST",
		"/api/notifications/devices/status",
		{ endpoint: SUBSCRIPTION.endpoint },
		{},
	);
	assertEquals([guest.status, guest.headers.get("cache-control")], [401, "no-store"]);
});
