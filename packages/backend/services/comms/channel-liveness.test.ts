import { assertEquals } from "@std/assert";
import { NO_LIVE_CHANNELS, parseChannelLivenessOverride } from "@projective/types/comms";
import {
	channelLiveness,
	type DeliverySources,
	deliverySources,
	resolveChannelLiveness,
} from "./channel-liveness.ts";
import { toB64Url } from "./transport-webpush.ts";

async function withEnvAsync(
	vars: Record<string, string | undefined>,
	fn: () => Promise<void>,
): Promise<void> {
	const apply = (name: string, value: string | undefined) =>
		value === undefined ? Deno.env.delete(name) : Deno.env.set(name, value);
	const before = Object.keys(vars).map((name) => [name, Deno.env.get(name)] as const);
	Object.entries(vars).forEach(([name, value]) => apply(name, value));
	try {
		await fn();
	} finally {
		before.forEach(([name, value]) => apply(name, value));
	}
}

const EVERY_TRANSPORT = { email: true, push: true, sms: true } as const;
const NO_TRANSPORT = { email: false, push: false, sms: false } as const;
/** Push unconfigured, whatever the developer's own environment holds. */
const NO_VAPID = {
	VAPID_PUBLIC_KEY: undefined,
	VAPID_PRIVATE_KEY: undefined,
	VAPID_SUBJECT: undefined,
};

Deno.test("resolveChannelLiveness — a configured transport with no dispatcher sends nothing", () => {
	assertEquals(
		resolveChannelLiveness({ dispatcher: false, transports: EVERY_TRANSPORT }),
		NO_LIVE_CHANNELS,
	);
});

Deno.test("resolveChannelLiveness — a dispatcher with no transport sends nothing", () => {
	assertEquals(
		resolveChannelLiveness({ dispatcher: true, transports: NO_TRANSPORT }),
		NO_LIVE_CHANNELS,
	);
});

Deno.test("resolveChannelLiveness — a channel is live once the dispatcher runs and its transport is configured", () => {
	const sources: DeliverySources = {
		dispatcher: true,
		transports: { email: true, push: false, sms: false },
	};
	assertEquals(resolveChannelLiveness(sources), { email: true, push: false, sms: false });
});

Deno.test("deliverySources — the dispatcher half is the running dispatcher, the transports half its registry", async () => {
	const sources = await deliverySources(
		() => Promise.resolve(true),
		() => ({ email: true, push: false, sms: false }),
	);
	assertEquals(sources, { dispatcher: true, transports: { email: true, push: false, sms: false } });
});

Deno.test("deliverySources — email is live once the dispatcher runs and Resend is configured (NT3); push and SMS are not", async () => {
	await withEnvAsync({
		RESEND_API_KEY: "re_live_key",
		MAIL_FROM: "Projective <no-reply@example.com>",
		...NO_VAPID,
	}, async () => {
		const sources = await deliverySources(() => Promise.resolve(true));
		assertEquals(sources.transports, { email: true, push: false, sms: false });
		assertEquals(await channelLiveness(null, sources), { email: true, push: false, sms: false });
		// The same key with no dispatcher running still sends nothing.
		const stopped = await deliverySources(() => Promise.resolve(false));
		assertEquals(await channelLiveness(null, stopped), NO_LIVE_CHANNELS);
	});
});

Deno.test("deliverySources — push is live once the dispatcher runs and all three VAPID keys are well formed (NT4)", async () => {
	const pair = await crypto.subtle.generateKey({ name: "ECDSA", namedCurve: "P-256" }, true, [
		"sign",
		"verify",
	]);
	const vapid = {
		VAPID_PUBLIC_KEY: toB64Url(
			new Uint8Array(await crypto.subtle.exportKey("raw", pair.publicKey)),
		),
		VAPID_PRIVATE_KEY: (await crypto.subtle.exportKey("jwk", pair.privateKey)).d,
		VAPID_SUBJECT: "mailto:ops@example.test",
	};
	await withEnvAsync({ RESEND_API_KEY: undefined, ...vapid }, async () => {
		const sources = await deliverySources(() => Promise.resolve(true));
		assertEquals(sources.transports, { email: false, push: true, sms: false });
		assertEquals(await channelLiveness(null, sources), { email: false, push: true, sms: false });
		const stopped = await deliverySources(() => Promise.resolve(false));
		assertEquals(await channelLiveness(null, stopped), NO_LIVE_CHANNELS);
	});
	// One key a placeholder, or the subject missing, and push is no transport.
	for (const broken of [{ VAPID_PRIVATE_KEY: "XXXX-XXXX" }, { VAPID_SUBJECT: undefined }]) {
		await withEnvAsync({ RESEND_API_KEY: undefined, ...vapid, ...broken }, async () => {
			assertEquals((await deliverySources(() => Promise.resolve(true))).transports.push, false);
		});
	}
});

Deno.test("deliverySources — the placeholder Resend key is no email transport", async () => {
	await withEnvAsync({
		RESEND_API_KEY: "XXXX-XXXX",
		MAIL_FROM: "Projective <no-reply@example.com>",
		...NO_VAPID,
	}, async () => {
		assertEquals((await deliverySources(() => Promise.resolve(true))).transports, NO_TRANSPORT);
	});
});

Deno.test("deliverySources — no dispatcher bearer, no dispatcher: the placeholder and a short secret count as absent", async () => {
	for (const secret of [undefined, "XXXX-XXXX", "short-secret"]) {
		await withEnvAsync({ COMMS_DISPATCH_SECRET: secret, AUTH_BACKEND_LIVE: "true" }, async () => {
			assertEquals((await deliverySources()).dispatcher, false, String(secret));
		});
	}
});

Deno.test("channelLiveness — the development override wins over the sources", async () => {
	const live: DeliverySources = { dispatcher: true, transports: EVERY_TRANSPORT };
	assertEquals(await channelLiveness("live", { dispatcher: false, transports: NO_TRANSPORT }), {
		email: true,
		push: true,
		sms: true,
	});
	assertEquals(await channelLiveness("off", live), NO_LIVE_CHANNELS);
	assertEquals(await channelLiveness(null, live), { email: true, push: true, sms: true });
});

Deno.test("parseChannelLivenessOverride — only live and off are overrides", () => {
	assertEquals(parseChannelLivenessOverride(" live "), "live");
	assertEquals(parseChannelLivenessOverride("off"), "off");
	for (const raw of [undefined, null, "", "auto", "LIVE", "on"]) {
		assertEquals(parseChannelLivenessOverride(raw), null);
	}
});
