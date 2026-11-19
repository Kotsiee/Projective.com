import type { NotificationUrgency } from "@projective/types/comms";
import { serverEnv } from "../../core/env.ts";
import type { DispatchTransport, TransportOutcome } from "./dispatch-transports.ts";

/**
 * transport-webpush — the dispatcher's push channel for browsers (COMMS NT4; providers spec §8.2).
 *
 * Standards, all through Web Crypto with no dependency:
 * - **VAPID (RFC 8292):** an ES256 JWT with `aud` = the endpoint's origin, `exp` ≤ 24 h and
 *   `sub` = `VAPID_SUBJECT`, sent as `Authorization: vapid t=…, k=<public key>`.
 * - **Encryption (RFC 8291 / RFC 8188):** the payload is encrypted `aes128gcm` to the subscription's
 *   `p256dh` key and `auth` secret, in one record of 4096 octets.
 * - **Headers:** `TTL` (a day, the claim's own window), `Urgency` (from `comms.notification_urgency`)
 *   and `Topic` (the notification's collapse key, else its id).
 *
 * The payload is `{ title, url, id, tag }`, never a notification's body or payload (EPI §3.5 rule 4).
 * `url` is a same-origin PATH, which `sw.js` re-checks before opening.
 *
 * Endpoints come from browsers, so the server only ever POSTs to a known push service over https
 * ({@link isPushEndpoint}): checked when a device registers and again before every send. An
 * arbitrary URL would otherwise be a way to make the dispatcher call into a private network.
 *
 * Answers: 201 → sent; 404 or 410 → `gone` (NT2 revokes the device); 413 → failed and logged (a
 * payload bug); 429 or 5xx → failed, for the sweep's back-off.
 */

type Bytes = Uint8Array<ArrayBuffer>;

// #region Encoding
/** base64url without padding. */
export function toB64Url(bytes: Bytes): string {
	let binary = "";
	for (const b of bytes) binary += String.fromCharCode(b);
	return btoa(binary).replaceAll("+", "-").replaceAll("/", "_").replace(/=+$/, "");
}

/** Decode base64url (padding optional), or null for anything that is not. */
export function fromB64Url(text: string | null | undefined): Bytes | null {
	const value = text?.trim() ?? "";
	if (!value || !/^[A-Za-z0-9_-]+={0,2}$/.test(value)) return null;
	try {
		const binary = atob(value.replace(/=+$/, "").replaceAll("-", "+").replaceAll("_", "/"));
		return Uint8Array.from(binary, (c) => c.charCodeAt(0));
	} catch {
		return null;
	}
}

function concat(...parts: Bytes[]): Bytes {
	const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
	let at = 0;
	for (const p of parts) {
		out.set(p, at);
		at += p.length;
	}
	return out;
}

const utf8 = (text: string): Bytes => new TextEncoder().encode(text);
// #endregion

// #region Configuration
/** A usable VAPID keypair and subject. */
export interface VapidConfig {
	/** The raw uncompressed P-256 public key, 65 octets beginning 0x04. */
	publicKey: Bytes;
	/** The same, base64url, as the browser and the `k=` parameter take it. */
	publicKeyText: string;
	/** The 32-octet private scalar. */
	privateKey: Bytes;
	/** `mailto:…` or `https://…`. */
	subject: string;
}

/**
 * The configured VAPID keypair, or null while any half is missing, the `XXXX-XXXX` placeholder or
 * the wrong shape (EPI §3.2): then push is off, no transport registers, and nothing is offered.
 */
export function vapidConfig(
	env: { vapidPublicKey?: string; vapidPrivateKey?: string; vapidSubject?: string } = serverEnv(),
): VapidConfig | null {
	const publicKey = fromB64Url(env.vapidPublicKey);
	const privateKey = fromB64Url(env.vapidPrivateKey);
	const subject = env.vapidSubject?.trim() ?? "";
	if (!publicKey || publicKey.length !== 65 || publicKey[0] !== 0x04) return null;
	if (!privateKey || privateKey.length !== 32) return null;
	if (!/^mailto:[^@\s]+@[^@\s]+$/.test(subject) && !/^https:\/\/[^\s]+$/.test(subject)) return null;
	return { publicKey, publicKeyText: toB64Url(publicKey), privateKey, subject };
}

/** The P-256 JWK for a raw public point and, optionally, its private scalar. */
function p256Jwk(publicKey: Bytes, privateKey?: Bytes): JsonWebKey {
	return {
		kty: "EC",
		crv: "P-256",
		x: toB64Url(publicKey.slice(1, 33)),
		y: toB64Url(publicKey.slice(33, 65)),
		...(privateKey ? { d: toB64Url(privateKey) } : {}),
		ext: true,
	};
}
// #endregion

// #region Push services
/** The push services browsers hand out endpoints for. Anything else is refused. */
const PUSH_HOSTS = [
	"fcm.googleapis.com",
	"android.googleapis.com",
	"push.services.mozilla.com",
	"notify.windows.com",
	"push.apple.com",
];

/** Whether `endpoint` is an https URL on a known push service, with no credentials or odd port. */
export function isPushEndpoint(endpoint: string | null | undefined): boolean {
	if (!endpoint || endpoint.length > 2048) return false;
	let url: URL;
	try {
		url = new URL(endpoint);
	} catch {
		return false;
	}
	if (url.protocol !== "https:" || url.username || url.password || url.port) return false;
	const host = url.hostname.toLowerCase();
	return PUSH_HOSTS.some((h) => host === h || host.endsWith(`.${h}`));
}
// #endregion

// #region VAPID (RFC 8292)
/** How long a signed VAPID token is good for: 12 hours, inside the 24 h the spec allows. */
const VAPID_LIFETIME_SECONDS = 12 * 3600;

/** The `Authorization` header value for one send to `endpoint`. */
export async function vapidAuthorization(
	endpoint: string,
	config: VapidConfig,
	nowSeconds: number = Math.floor(Date.now() / 1000),
): Promise<string> {
	const header = toB64Url(utf8(JSON.stringify({ typ: "JWT", alg: "ES256" })));
	const claims = toB64Url(utf8(JSON.stringify({
		aud: new URL(endpoint).origin,
		exp: nowSeconds + VAPID_LIFETIME_SECONDS,
		sub: config.subject,
	})));
	const key = await crypto.subtle.importKey(
		"jwk",
		p256Jwk(config.publicKey, config.privateKey),
		{ name: "ECDSA", namedCurve: "P-256" },
		false,
		["sign"],
	);
	// Web Crypto answers ECDSA as raw r ‖ s (64 octets), which is exactly JWS's ES256 encoding.
	const signature = new Uint8Array(
		await crypto.subtle.sign({ name: "ECDSA", hash: "SHA-256" }, key, utf8(`${header}.${claims}`)),
	);
	return `vapid t=${header}.${claims}.${toB64Url(signature)}, k=${config.publicKeyText}`;
}
// #endregion

// #region Encryption (RFC 8291)
/** The single record's size. A payload must fit in it with its delimiter and the 16-octet tag. */
const RECORD_SIZE = 4096;

async function hmac(key: Bytes, message: Bytes): Promise<Bytes> {
	const k = await crypto.subtle.importKey("raw", key, { name: "HMAC", hash: "SHA-256" }, false, [
		"sign",
	]);
	return new Uint8Array(await crypto.subtle.sign("HMAC", k, message));
}

/** Fixed sender material, for the RFC 8291 test vector only; a real send generates both. */
export interface SenderMaterial {
	senderPrivate: Bytes;
	senderPublic: Bytes;
	salt: Bytes;
}

/**
 * Encrypt `plaintext` for a subscription (`uaPublic` = its p256dh, `authSecret` = its auth), as the
 * complete `aes128gcm` body: salt ‖ rs ‖ idlen ‖ sender key ‖ ciphertext. Throws
 * `payload_too_large` when the payload does not fit one record.
 */
export async function encryptPayload(
	plaintext: Bytes,
	uaPublic: Bytes,
	authSecret: Bytes,
	material?: SenderMaterial,
): Promise<Bytes> {
	if (uaPublic.length !== 65 || uaPublic[0] !== 0x04) throw new Error("bad_subscription_key");
	if (authSecret.length !== 16) throw new Error("bad_subscription_auth");
	if (plaintext.length + 1 + 16 > RECORD_SIZE) throw new Error("payload_too_large");

	let senderPrivateKey: CryptoKey;
	let senderPublic: Bytes;
	if (material) {
		senderPublic = material.senderPublic;
		senderPrivateKey = await crypto.subtle.importKey(
			"jwk",
			p256Jwk(material.senderPublic, material.senderPrivate),
			{ name: "ECDH", namedCurve: "P-256" },
			false,
			["deriveBits"],
		);
	} else {
		const pair = await crypto.subtle.generateKey({ name: "ECDH", namedCurve: "P-256" }, true, [
			"deriveBits",
		]) as CryptoKeyPair;
		senderPrivateKey = pair.privateKey;
		senderPublic = new Uint8Array(await crypto.subtle.exportKey("raw", pair.publicKey));
	}
	const salt = material?.salt ?? crypto.getRandomValues(new Uint8Array(16));

	const receiverKey = await crypto.subtle.importKey(
		"raw",
		uaPublic,
		{ name: "ECDH", namedCurve: "P-256" },
		false,
		[],
	);
	const ecdhSecret = new Uint8Array(
		await crypto.subtle.deriveBits({ name: "ECDH", public: receiverKey }, senderPrivateKey, 256),
	);

	// RFC 8291 §3.4: IKM from the auth secret and the two public keys; then RFC 8188's CEK and nonce.
	const prkKey = await hmac(authSecret, ecdhSecret);
	const keyInfo = concat(utf8("WebPush: info"), new Uint8Array([0]), uaPublic, senderPublic);
	const ikm = await hmac(prkKey, concat(keyInfo, new Uint8Array([1])));
	const prk = await hmac(salt, ikm);
	const cek = (await hmac(prk, concat(utf8("Content-Encoding: aes128gcm"), new Uint8Array([0, 1]))))
		.slice(0, 16);
	const nonce = (await hmac(prk, concat(utf8("Content-Encoding: nonce"), new Uint8Array([0, 1]))))
		.slice(0, 12);

	const aes = await crypto.subtle.importKey("raw", cek, { name: "AES-GCM" }, false, ["encrypt"]);
	// One record, so it is the last: the padding delimiter is 0x02 with no padding after it.
	const ciphertext = new Uint8Array(
		await crypto.subtle.encrypt(
			{ name: "AES-GCM", iv: nonce },
			aes,
			concat(plaintext, new Uint8Array([2])),
		),
	);

	const header = new Uint8Array(16 + 4 + 1 + senderPublic.length);
	header.set(salt, 0);
	new DataView(header.buffer).setUint32(16, RECORD_SIZE);
	header[20] = senderPublic.length;
	header.set(senderPublic, 21);
	return concat(header, ciphertext);
}
// #endregion

// #region Headers
/** RFC 8030 §5.3 urgency for each notification urgency. */
const URGENCY: Readonly<Record<NotificationUrgency, "low" | "normal" | "high">> = {
	critical: "high",
	high: "high",
	medium: "normal",
	low: "low",
};

/** A day: past it the claim would not send the delivery either. */
export const PUSH_TTL_SECONDS = 86_400;

/**
 * The `Topic` (RFC 8030 §5.4, at most 32 URL-safe base64 characters): a hash of the collapse key, so
 * a collapsed notification replaces its earlier push and the key itself never leaves Projective;
 * else the notification id without hyphens.
 */
export async function topicOf(groupKey: string | null, notificationId: string): Promise<string> {
	if (groupKey) {
		const digest = new Uint8Array(await crypto.subtle.digest("SHA-256", utf8(groupKey)));
		return toB64Url(digest).slice(0, 32);
	}
	return notificationId.replaceAll("-", "").slice(0, 32);
}
// #endregion

// #region Transport
/** What a send reads from its surroundings, injectable for tests. */
export interface WebPushDeps {
	fetch: typeof fetch;
	nowSeconds: () => number;
}

const SEND_TIMEOUT_MS = 10_000;

/**
 * The push `DispatchTransport`, or null while VAPID is not configured, so push deliveries wait
 * pending and no surface offers push.
 */
export function webPushTransport(
	config: VapidConfig | null = vapidConfig(),
	deps: WebPushDeps = { fetch, nowSeconds: () => Math.floor(Date.now() / 1000) },
): DispatchTransport | null {
	if (!config) return null;
	return {
		channel: "push",
		provider: "web_push",
		async send(delivery, payload): Promise<TransportOutcome> {
			const fail = (error: string): TransportOutcome => ({
				status: "failed",
				provider: "web_push",
				error,
			});
			const d = delivery.destination;
			if (!d || !("endpoint" in d) || !d.endpoint || !d.p256dh || !d.auth) {
				return fail("no_subscription");
			}
			if (!isPushEndpoint(d.endpoint)) return fail("endpoint_refused");
			const uaPublic = fromB64Url(d.p256dh);
			const authSecret = fromB64Url(d.auth);
			if (!uaPublic || !authSecret) return fail("bad_subscription");

			const link = new URL(payload.link);
			const tag = await topicOf(delivery.groupKey, payload.notificationId);
			const body = await encryptPayload(
				utf8(JSON.stringify({
					title: payload.title,
					url: link.pathname + link.search + link.hash,
					id: payload.notificationId,
					tag,
				})),
				uaPublic,
				authSecret,
			);

			const res = await deps.fetch(d.endpoint, {
				method: "POST",
				headers: {
					authorization: await vapidAuthorization(d.endpoint, config, deps.nowSeconds()),
					"content-encoding": "aes128gcm",
					"content-type": "application/octet-stream",
					ttl: String(PUSH_TTL_SECONDS),
					urgency: URGENCY[delivery.urgency] ?? "normal",
					topic: tag,
				},
				body,
				redirect: "manual",
				signal: AbortSignal.timeout(SEND_TIMEOUT_MS),
			});
			await res.body?.cancel();

			if (res.status === 201 || res.status === 200 || res.status === 202) {
				return { status: "sent", provider: "web_push", providerRef: null };
			}
			if (res.status === 404 || res.status === 410) return fail("gone");
			if (res.status === 413) {
				console.error("[comms:push] a payload was too large", delivery.deliveryId);
				return fail("payload_too_large");
			}
			return fail(`push_${res.status}`);
		},
	};
}
// #endregion
