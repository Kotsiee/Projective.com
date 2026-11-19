import { assertEquals } from "@std/assert";
import { PushDeviceBackendService } from "./PushDeviceBackendService.ts";
import { configuredChannels } from "./dispatch-transports.ts";
import { toB64Url } from "./transport-webpush.ts";
import type { ReadActor } from "../read-actor.ts";

/** Push is configured only with all three VAPID keys; the config read and registration follow. */

async function withVapid(on: boolean, fn: () => Promise<void> | void): Promise<void> {
	const names = ["VAPID_PUBLIC_KEY", "VAPID_PRIVATE_KEY", "VAPID_SUBJECT"];
	const keep = names.map((n) => [n, Deno.env.get(n)] as const);
	try {
		if (on) {
			const pair = await crypto.subtle.generateKey({ name: "ECDSA", namedCurve: "P-256" }, true, [
				"sign",
			]) as CryptoKeyPair;
			Deno.env.set(
				"VAPID_PUBLIC_KEY",
				toB64Url(new Uint8Array(await crypto.subtle.exportKey("raw", pair.publicKey))),
			);
			Deno.env.set("VAPID_PRIVATE_KEY", (await crypto.subtle.exportKey("jwk", pair.privateKey)).d!);
			Deno.env.set("VAPID_SUBJECT", "mailto:ops@example.test");
		} else {
			for (const n of names) Deno.env.set(n, "XXXX-XXXX");
		}
		await fn();
	} finally {
		for (const [n, v] of keep) v === undefined ? Deno.env.delete(n) : Deno.env.set(n, v);
	}
}

const ACTOR = {
	userId: "0b8e6c4a-2d1f-4e3b-8a7c-9d0e1f2a3b4c",
	accessToken: "t",
} as unknown as ReadActor;
const SUBSCRIPTION = {
	endpoint: "https://169.254.169.254/latest/meta-data",
	keys: { p256dh: "B".repeat(87), auth: "A".repeat(22) },
};

Deno.test("config — 404 while VAPID is the placeholder; the public key once it is configured", async () => {
	await withVapid(false, () => {
		const res = PushDeviceBackendService.config();
		assertEquals([res.ok, res.status], [false, 404]);
		assertEquals(configuredChannels().push, false);
	});
	await withVapid(true, () => {
		const res = PushDeviceBackendService.config();
		assertEquals([res.ok, res.data?.publicKey === Deno.env.get("VAPID_PUBLIC_KEY")], [true, true]);
		assertEquals(configuredChannels().push, true);
	});
});

Deno.test("register — not configured is a 404; an endpoint that is no push service is a 422, before any database call", async () => {
	await withVapid(false, async () => {
		assertEquals((await PushDeviceBackendService.register(ACTOR, SUBSCRIPTION, null)).status, 404);
	});
	await withVapid(true, async () => {
		const res = await PushDeviceBackendService.register(ACTOR, SUBSCRIPTION, null);
		assertEquals([res.status, res.errors?.endpoint], [422, "Not a supported push service."]);
	});
});
