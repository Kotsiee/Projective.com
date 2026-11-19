import { assert, assertEquals, assertRejects } from "@std/assert";
import type { ClaimedDelivery } from "@projective/types/comms";
import { buildDispatchPayload } from "./dispatch-payload.ts";
import {
	encryptPayload,
	fromB64Url,
	isPushEndpoint,
	MAX_PLAINTEXT,
	toB64Url,
	topicOf,
	vapidAuthorization,
	vapidConfig,
	webPushTransport,
} from "./transport-webpush.ts";

// #region RFC 8291 §5 / Appendix A
const RFC = {
	plaintext: "V2hlbiBJIGdyb3cgdXAsIEkgd2FudCB0byBiZSBhIHdhdGVybWVsb24",
	authSecret: "BTBZMqHH6r4Tts7J_aSIgg",
	salt: "DGv6ra1nlYgDCS1FRnbzlw",
	receiverPublic:
		"BCVxsr7N_eNgVRqvHtD0zTZsEc6-VV-JvLexhqUzORcxaOzi6-AYWXvTBHm4bjyPjs7Vd8pZGH6SRpkNtoIAiw4",
	senderPrivate: "yfWPiYE-n46HLnH0KqZOF1fJJU3MYrct3AELtAQ-oRw",
	senderPublic:
		"BP4z9KsN6nGRTbVYI_c7VJSPQTBtkgcy27mlmlMoZIIgDll6e3vCYLocInmYWAmS6TlzAC8wEqKK6PBru3jl7A8",
	body:
		"DGv6ra1nlYgDCS1FRnbzlwAAEABBBP4z9KsN6nGRTbVYI_c7VJSPQTBtkgcy27mlmlMoZIIgDll6e3vCYLocInmYWAmS6TlzAC8wEqKK6PBru3jl7A_yl95bQpu6cVPTpK4Mqgkf1CXztLVBSt2Ks3oZwbuwXPXLWyouBWLVWGNWQexSgSxsj_Qulcy4a-fN",
};
const b = (text: string) => fromB64Url(text)!;
// #endregion

Deno.test("encryptPayload — reproduces RFC 8291's published aes128gcm body exactly", async () => {
	const body = await encryptPayload(b(RFC.plaintext), b(RFC.receiverPublic), b(RFC.authSecret), {
		senderPrivate: b(RFC.senderPrivate),
		senderPublic: b(RFC.senderPublic),
		salt: b(RFC.salt),
	});
	assertEquals(toB64Url(body), RFC.body);
	assertEquals(body.length, 144);
});

Deno.test("encryptPayload — a fresh send uses its own key and salt each time, and the body never passes 4096 octets", async () => {
	const once = await encryptPayload(b(RFC.plaintext), b(RFC.receiverPublic), b(RFC.authSecret));
	const twice = await encryptPayload(b(RFC.plaintext), b(RFC.receiverPublic), b(RFC.authSecret));
	assertEquals(once.length, 144);
	assert(toB64Url(once) !== toB64Url(twice));
	// The largest plaintext makes a body of exactly 4096 octets, header included; one more is refused.
	assertEquals(MAX_PLAINTEXT, 3993);
	const largest = await encryptPayload(
		new Uint8Array(MAX_PLAINTEXT),
		b(RFC.receiverPublic),
		b(RFC.authSecret),
	);
	assertEquals(largest.length, 4096);
	await assertRejects(
		() =>
			encryptPayload(new Uint8Array(MAX_PLAINTEXT + 1), b(RFC.receiverPublic), b(RFC.authSecret)),
		Error,
		"payload_too_large",
	);
});

// #region VAPID
async function testKeys() {
	const pair = await crypto.subtle.generateKey({ name: "ECDSA", namedCurve: "P-256" }, true, [
		"sign",
		"verify",
	]) as CryptoKeyPair;
	const publicRaw = new Uint8Array(await crypto.subtle.exportKey("raw", pair.publicKey));
	const jwk = await crypto.subtle.exportKey("jwk", pair.privateKey);
	return { publicKey: toB64Url(publicRaw), privateKey: jwk.d!, verifyKey: pair.publicKey };
}

Deno.test("vapidConfig — the three keys well formed, or nothing; the placeholder counts as absent", async () => {
	const k = await testKeys();
	assert(
		vapidConfig({
			vapidPublicKey: k.publicKey,
			vapidPrivateKey: k.privateKey,
			vapidSubject: "mailto:ops@example.test",
		}),
	);
	for (
		const env of [
			{
				vapidPublicKey: "XXXX-XXXX",
				vapidPrivateKey: k.privateKey,
				vapidSubject: "mailto:ops@example.test",
			},
			{
				vapidPublicKey: k.publicKey,
				vapidPrivateKey: "XXXX-XXXX",
				vapidSubject: "mailto:ops@example.test",
			},
			{ vapidPublicKey: k.publicKey, vapidPrivateKey: k.privateKey, vapidSubject: "XXXX-XXXX" },
			{ vapidPublicKey: k.publicKey, vapidPrivateKey: k.privateKey, vapidSubject: undefined },
			{},
		]
	) {
		assertEquals(vapidConfig(env), null, JSON.stringify(env).slice(0, 60));
	}
	assertEquals(webPushTransport(null), null);
});

Deno.test("vapidAuthorization — an ES256 JWT for the endpoint's origin, at most a day long, that verifies", async () => {
	const k = await testKeys();
	const config = vapidConfig({
		vapidPublicKey: k.publicKey,
		vapidPrivateKey: k.privateKey,
		vapidSubject: "mailto:ops@example.test",
	})!;
	const value = await vapidAuthorization(
		"https://fcm.googleapis.com/fcm/send/abc:def",
		config,
		1_800_000_000,
	);
	const [, jwt, key] = value.match(/^vapid t=([^,]+), k=(.+)$/)!;
	assertEquals(key, k.publicKey);
	const [h, c, s] = jwt.split(".");
	assertEquals(JSON.parse(new TextDecoder().decode(b(h))), { typ: "JWT", alg: "ES256" });
	const claims = JSON.parse(new TextDecoder().decode(b(c)));
	assertEquals(claims.aud, "https://fcm.googleapis.com");
	assertEquals(claims.sub, "mailto:ops@example.test");
	assert(claims.exp - 1_800_000_000 <= 86_400 && claims.exp > 1_800_000_000);
	assert(
		await crypto.subtle.verify(
			{ name: "ECDSA", hash: "SHA-256" },
			k.verifyKey,
			b(s),
			new TextEncoder().encode(`${h}.${c}`),
		),
		"the signature verifies with the public key",
	);
});
// #endregion

Deno.test("isPushEndpoint — known push services over https only", () => {
	for (
		const ok of [
			"https://fcm.googleapis.com/fcm/send/abc",
			"https://updates.push.services.mozilla.com/wpush/v2/abc",
			"https://wns2-par02p.notify.windows.com/w/?token=abc",
			"https://web.push.apple.com/QGa",
		]
	) assert(isPushEndpoint(ok), ok);
	for (
		const bad of [
			"http://fcm.googleapis.com/fcm/send/abc",
			"https://evil.example/fcm.googleapis.com",
			"https://fcm.googleapis.com.evil.example/x",
			"https://user:pass@fcm.googleapis.com/x",
			"https://fcm.googleapis.com:8443/x",
			"https://169.254.169.254/latest",
			"https://localhost/x",
			"not a url",
			"",
		]
	) assertEquals(isPushEndpoint(bad), false, bad);
});

Deno.test("topicOf — a hashed collapse key or the bare id, at most 32 URL-safe characters", async () => {
	const t = await topicOf("profile.followed:someone", "6f3d2b0a-1c4e-4d8a-9b7f-0a1b2c3d4e5f");
	assertEquals(t.length, 32);
	assert(/^[A-Za-z0-9_-]+$/.test(t) && !t.includes("profile"));
	assertEquals(
		await topicOf(null, "6f3d2b0a-1c4e-4d8a-9b7f-0a1b2c3d4e5f"),
		"6f3d2b0a1c4e4d8a9b7f0a1b2c3d4e5f",
	);
});

// #region Sending
const APP = "https://staging.projective.test";
const subscriber = async () => {
	const pair = await crypto.subtle.generateKey({ name: "ECDH", namedCurve: "P-256" }, true, [
		"deriveBits",
	]) as CryptoKeyPair;
	return toB64Url(new Uint8Array(await crypto.subtle.exportKey("raw", pair.publicKey)));
};

async function delivery(
	endpoint = "https://fcm.googleapis.com/fcm/send/abc",
): Promise<ClaimedDelivery> {
	return {
		deliveryId: "00000000-0000-4000-8000-000000000001",
		notificationId: "6f3d2b0a-1c4e-4d8a-9b7f-0a1b2c3d4e5f",
		userId: "0b8e6c4a-2d1f-4e3b-8a7c-9d0e1f2a3b4c",
		channel: "push",
		status: "queued",
		attempts: 1,
		suppressedReason: null,
		destination: {
			device_id: "00000000-0000-4000-8000-0000000000d1",
			provider: "web_push",
			token: endpoint,
			endpoint,
			p256dh: await subscriber(),
			auth: toB64Url(crypto.getRandomValues(new Uint8Array(16))),
		},
		title: "Stage 2 was funded",
		actionUrl: "/projects/prj-abc123?tab=money",
		type: "escrow.funded",
		category: "money",
		urgency: "critical",
		groupKey: null,
	};
}

async function transportAnswering(status: number) {
	const k = await testKeys();
	const config = vapidConfig({
		vapidPublicKey: k.publicKey,
		vapidPrivateKey: k.privateKey,
		vapidSubject: "mailto:ops@example.test",
	})!;
	const calls: { url: string; init: RequestInit }[] = [];
	const transport = webPushTransport(config, {
		fetch: ((url: string, init: RequestInit) => {
			calls.push({ url, init });
			return Promise.resolve(new Response(null, { status }));
		}) as typeof fetch,
		nowSeconds: () => 1_800_000_000,
	})!;
	return { transport, calls };
}

Deno.test("send — a 201 is sent, with the RFC 8030 headers and an encrypted body that names no body", async () => {
	const { transport, calls } = await transportAnswering(201);
	const d = await delivery();
	const outcome = await transport.send(d, buildDispatchPayload(d, APP));
	assertEquals(outcome, { status: "sent", provider: "web_push", providerRef: null });
	const headers = calls[0].init.headers as Record<string, string>;
	assertEquals(calls[0].url, "https://fcm.googleapis.com/fcm/send/abc");
	assertEquals([headers["content-encoding"], headers.ttl, headers.urgency], [
		"aes128gcm",
		"86400",
		"high",
	]);
	assertEquals(headers.topic, "6f3d2b0a1c4e4d8a9b7f0a1b2c3d4e5f");
	assert(headers.authorization.startsWith("vapid t="));
	assertEquals(calls[0].init.redirect, "manual");
	const sent = calls[0].init.body as Uint8Array;
	assert(
		!new TextDecoder().decode(sent).includes("Stage 2"),
		"the title is encrypted, not in the clear",
	);
});

Deno.test("send — an overlong title is cut to 200 characters, so the body stays inside 4096 octets", async () => {
	const { transport, calls } = await transportAnswering(201);
	const d = { ...(await delivery()), title: "x".repeat(5000) };
	assertEquals((await transport.send(d, buildDispatchPayload(d, APP))).status, "sent");
	assert(
		(calls[0].init.body as Uint8Array).length < 600,
		"200 title characters and the link, encrypted",
	);
});

Deno.test("send — 404 and 410 are gone (the device is revoked), 413 a logged failure, 429 and 5xx retryable", async () => {
	const expect: Record<number, string> = {
		404: "gone",
		410: "gone",
		413: "payload_too_large",
		429: "push_429",
		503: "push_503",
	};
	for (const [status, error] of Object.entries(expect)) {
		const { transport } = await transportAnswering(Number(status));
		const d = await delivery();
		assertEquals(await transport.send(d, buildDispatchPayload(d, APP)), {
			status: "failed",
			provider: "web_push",
			error,
		}, status);
	}
});

Deno.test("send — an endpoint that is not a push service is refused before any request", async () => {
	const { transport, calls } = await transportAnswering(201);
	const d = await delivery("https://169.254.169.254/latest/meta-data");
	assertEquals((await transport.send(d, buildDispatchPayload(d, APP))).error, "endpoint_refused");
	assertEquals(calls.length, 0);
});
// #endregion
