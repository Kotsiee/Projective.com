/**
 * pending-verification — the signed, short-lived token that binds `/verify`'s confirmation poll to
 * the browser that created (or signed in to) an unconfirmed account (Decision #185).
 *
 * The token names the pending account's user id and an expiry, and is HMAC-SHA256 signed with a key
 * derived from a server-only root secret. It travels only in an HttpOnly cookie, so page script can
 * neither read nor forge it, and the poll answers only for the id it carries — never for an address
 * a caller types.
 *
 * Shape: `v1.<userId>.<expiresAtEpochSeconds>.<base64url(hmac)>`.
 */

// #region Constants
/** How long a pending-verification token stays valid: GoTrue's default OTP lifetime (1 hour). */
export const PENDING_VERIFICATION_TTL_SECONDS = 60 * 60;

const VERSION = "v1";
const KEY_LABEL = "projective:pending-verification:v1";
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
// #endregion

// #region Encoding
function toBase64Url(bytes: Uint8Array): string {
	let binary = "";
	for (const byte of bytes) binary += String.fromCharCode(byte);
	return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function fromBase64Url(text: string): Uint8Array<ArrayBuffer> | null {
	if (!/^[A-Za-z0-9_-]+$/.test(text)) return null;
	try {
		const binary = atob(text.replace(/-/g, "+").replace(/_/g, "/"));
		const out = new Uint8Array(binary.length);
		for (let i = 0; i < binary.length; i++) out[i] = binary.charCodeAt(i);
		return out;
	} catch {
		return null;
	}
}
// #endregion

// #region Keys
const keyCache = new Map<string, Promise<CryptoKey>>();

/**
 * The HMAC key for pending-verification tokens, derived from `rootSecret` under a fixed label so the
 * root secret itself never signs a cookie. Memoised per root secret.
 */
export function pendingVerificationKey(rootSecret: string): Promise<CryptoKey> {
	const cached = keyCache.get(rootSecret);
	if (cached) return cached;
	const derived = (async () => {
		const enc = new TextEncoder();
		const root = await crypto.subtle.importKey(
			"raw",
			enc.encode(rootSecret),
			{ name: "HMAC", hash: "SHA-256" },
			false,
			["sign"],
		);
		const raw = await crypto.subtle.sign("HMAC", root, enc.encode(KEY_LABEL));
		return crypto.subtle.importKey("raw", raw, { name: "HMAC", hash: "SHA-256" }, false, [
			"sign",
			"verify",
		]);
	})();
	keyCache.set(rootSecret, derived);
	return derived;
}
// #endregion

// #region Mint / read
/** Mint a token naming `userId`, valid for {@link PENDING_VERIFICATION_TTL_SECONDS} from `nowMs`. */
export async function mintPendingVerification(
	userId: string,
	key: CryptoKey,
	nowMs: number = Date.now(),
): Promise<string> {
	if (!UUID.test(userId)) throw new RangeError("A pending-verification token names a user id.");
	const expiresAt = Math.floor(nowMs / 1000) + PENDING_VERIFICATION_TTL_SECONDS;
	const body = `${VERSION}.${userId.toLowerCase()}.${expiresAt}`;
	const sig = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(body));
	return `${body}.${toBase64Url(new Uint8Array(sig))}`;
}

/**
 * The user id a token names, or `null` when it is absent, malformed, signed with another key, or
 * expired. The signature is checked with `crypto.subtle.verify` (constant time).
 */
export async function readPendingVerification(
	token: string | undefined | null,
	key: CryptoKey,
	nowMs: number = Date.now(),
): Promise<string | null> {
	if (!token) return null;
	const parts = token.split(".");
	if (parts.length !== 4) return null;
	const [version, userId, expiresRaw, sigRaw] = parts;
	if (version !== VERSION || !UUID.test(userId) || !/^\d{1,12}$/.test(expiresRaw)) return null;
	const sig = fromBase64Url(sigRaw);
	if (!sig) return null;
	const body = `${version}.${userId}.${expiresRaw}`;
	const valid = await crypto.subtle.verify("HMAC", key, sig, new TextEncoder().encode(body));
	if (!valid) return null;
	if (Number(expiresRaw) * 1000 <= nowMs) return null;
	return userId;
}
// #endregion
