import { serverEnv } from "../../core/env.ts";

/**
 * unsubscribe-token — the signed link in a marketing email's one-click `List-Unsubscribe` header
 * (RFC 8058; COMMS NT3).
 *
 * The token names the PERSON, never an address, so no address sits in a URL a mail client or a log
 * may keep: `<16 id bytes>.<HMAC-SHA256 over them>`, both base64url. `comms.fn_unsubscribe_marketing`
 * then suppresses that person's primary verified address for Marketing only.
 *
 * The signing key is derived from `COMMS_DISPATCH_SECRET` with a label of its own, so no second
 * secret needs provisioning: a link can only exist where the dispatcher sends, and the dispatcher
 * needs that secret. Rotating it retires the links already sent; the same mail also links to
 * Settings → Notifications, which never expires.
 */

// #region Encoding
const KEY_LABEL = "comms-unsubscribe-key:v1";
const MESSAGE_LABEL = "comms-unsubscribe:v1:";
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Bytes Web Crypto accepts (an `ArrayBuffer`-backed view). */
type Bytes = Uint8Array<ArrayBuffer>;

function toBase64Url(bytes: Bytes): string {
	let binary = "";
	for (const b of bytes) binary += String.fromCharCode(b);
	return btoa(binary).replaceAll("+", "-").replaceAll("/", "_").replace(/=+$/, "");
}

function fromBase64Url(text: string): Bytes | null {
	if (!/^[A-Za-z0-9_-]+$/.test(text)) return null;
	try {
		const binary = atob(text.replaceAll("-", "+").replaceAll("_", "/"));
		return Uint8Array.from(binary, (c) => c.charCodeAt(0));
	} catch {
		return null;
	}
}

function uuidBytes(id: string): Bytes | null {
	if (!UUID.test(id)) return null;
	const hex = id.replaceAll("-", "");
	return Uint8Array.from({ length: 16 }, (_, i) => parseInt(hex.slice(i * 2, i * 2 + 2), 16));
}

function bytesUuid(bytes: Bytes): string {
	const hex = Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
	return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${
		hex.slice(20)
	}`;
}

async function hmac(key: Bytes, message: Bytes): Promise<Bytes> {
	const cryptoKey = await crypto.subtle.importKey(
		"raw",
		key,
		{ name: "HMAC", hash: "SHA-256" },
		false,
		[
			"sign",
		],
	);
	return new Uint8Array(await crypto.subtle.sign("HMAC", cryptoKey, message));
}

/** The link-signing key, or null while the dispatcher bearer is not well formed. */
async function signingKey(secret: string | undefined): Promise<Bytes | null> {
	const trimmed = secret?.trim() ?? "";
	if (trimmed.length < 32) return null;
	const encoder = new TextEncoder();
	return await hmac(encoder.encode(trimmed), encoder.encode(KEY_LABEL));
}

function labelled(id: Bytes): Bytes {
	const label = new TextEncoder().encode(MESSAGE_LABEL);
	const message = new Uint8Array(label.length + id.length);
	message.set(label);
	message.set(id, label.length);
	return message;
}
// #endregion

// #region Sign + verify
/** The token for `userId`, or null where no link can be signed (no dispatcher secret, a bad id). */
export async function signUnsubscribeToken(
	userId: string,
	secret: string | undefined = serverEnv().commsDispatchSecret,
): Promise<string | null> {
	const id = uuidBytes(userId);
	const key = await signingKey(secret);
	if (!id || !key) return null;
	return `${toBase64Url(id)}.${toBase64Url(await hmac(key, labelled(id)))}`;
}

/** The person a token names, or null for anything that is not a token this key signed. */
export async function verifyUnsubscribeToken(
	token: string | null | undefined,
	secret: string | undefined = serverEnv().commsDispatchSecret,
): Promise<string | null> {
	const [idPart, sigPart, ...rest] = (token ?? "").trim().split(".");
	if (!idPart || !sigPart || rest.length || idPart.length > 32 || sigPart.length > 64) return null;
	const id = fromBase64Url(idPart);
	const sig = fromBase64Url(sigPart);
	const key = await signingKey(secret);
	if (!id || id.length !== 16 || !sig || !key) return null;
	const expected = await hmac(key, labelled(id));
	if (sig.length !== expected.length) return null;
	let diff = 0;
	for (let i = 0; i < sig.length; i++) diff |= sig[i] ^ expected[i];
	return diff === 0 ? bytesUuid(id) : null;
}

/** The one-click URL a marketing email's `List-Unsubscribe` header names. */
export function unsubscribeUrl(token: string, appUrl: string): string {
	const url = new URL("/api/comms/unsubscribe", new URL(appUrl).origin);
	url.searchParams.set("token", token);
	return url.href;
}
// #endregion
