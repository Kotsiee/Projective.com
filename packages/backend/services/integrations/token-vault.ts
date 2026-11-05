import type { SealedSecret } from "@projective/types/integrations";
import { serverEnv } from "../../core/env.ts";
import { isIntegrationsBackendLive } from "../../core/supabase.ts";

/**
 * token-vault — envelope encryption for `integrations.connection_secrets`.
 *
 * **SERVICE-ROLE ONLY.** That table has RLS on, no policy and no `authenticated` grant, and it is
 * projected by no view. Column safety is therefore STRUCTURAL, not a policy that could be loosened: a
 * client reads connections through `integrations.v_my_connections`, which physically cannot project a
 * token column. Nothing in this module may be reachable from a route that runs under a user's JWT.
 *
 * The key-encryption key is the `ENCRYPTION_KEY` env, not a KMS (Decision #343, ruling C4 (c), which
 * resolves Decision #59); the envelope columns are Decision #335 (b).
 *
 * ### The envelope
 *
 * Every write of a row mints a fresh 256-bit data key (DEK), wraps it under the KEK with AES-256-GCM
 * and its own nonce, and seals each token under the DEK with its own 96-bit nonce and the AAD
 * `<connection_id>|<kind>|<key_id>`, so a ciphertext moved to another row or another column fails its
 * tag. `key_id` is `env:` + the first 8 hex of sha256(KEK), and {@link unseal} refuses a row whose
 * `key_id` is not the current key's rather than decrypt garbage. Web Crypto appends each 16-byte tag
 * to its ciphertext, so no tag column exists.
 *
 * shortcut: no rewrap, a changed ENCRYPTION_KEY strands every row until each is reconnected; build
 * rewrap before the first key rotation (`key_id` already finds the rows).
 */

// #region Shapes

/** Which credential a sealed column holds. Part of each ciphertext's AAD. */
export type SecretKind = "access_token" | "refresh_token" | "api_secret";

/** The plaintexts one row holds. Only {@link seal} takes these, and it keeps none of them. */
export type SecretPlaintexts = Partial<Record<SecretKind, string>>;

/** Each kind's cipher and nonce columns. `nonce` is the access token's. */
const COLUMNS = {
	access_token: ["access_token_cipher", "nonce"],
	refresh_token: ["refresh_token_cipher", "refresh_token_nonce"],
	api_secret: ["api_secret_cipher", "api_secret_nonce"],
} as const satisfies Record<SecretKind, readonly [keyof SealedSecret, keyof SealedSecret]>;

const KINDS = Object.keys(COLUMNS) as SecretKind[];

// #endregion

// #region Bytes

const encoder = new TextEncoder();
const decoder = new TextDecoder();

const toHex = (bytes: Uint8Array) =>
	Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");

const fromHex = (hex: string) =>
	Uint8Array.from(hex.match(/../g) ?? [], (pair) => parseInt(pair, 16));

/** PostgREST's text form of a `bytea`. */
const toBytea = (bytes: Uint8Array) => `\\x${toHex(bytes)}`;
const fromBytea = (value: string) => fromHex(value.slice(2));

const randomNonce = () => crypto.getRandomValues(new Uint8Array(12));

const aad = (connectionId: string, kind: SecretKind, keyId: string) =>
	encoder.encode(`${connectionId}|${kind}|${keyId}`);

async function gcmSeal(
	key: CryptoKey,
	iv: Uint8Array<ArrayBuffer>,
	plaintext: Uint8Array<ArrayBuffer>,
	additionalData?: Uint8Array<ArrayBuffer>,
): Promise<string> {
	const params: AesGcmParams = additionalData
		? { name: "AES-GCM", iv, additionalData }
		: { name: "AES-GCM", iv };
	return toBytea(new Uint8Array(await crypto.subtle.encrypt(params, key, plaintext)));
}

// #endregion

// #region The key

/**
 * The configured KEK as hex, or `undefined` when it is missing, the `XXXX-XXXX` placeholder or not 32
 * bytes. Read at call time, never captured at import, so a changed key takes effect on the next write.
 */
function vaultKey(): string | undefined {
	const key = serverEnv().encryptionKey?.trim();
	return key && /^[0-9a-f]{64}$/i.test(key) ? key : undefined;
}

async function loadKek(): Promise<{ kek: CryptoKey; keyId: string }> {
	const hex = vaultKey();
	if (!hex) throw new Error("token-vault: ENCRYPTION_KEY must be 32 bytes of hex.");
	const raw = fromHex(hex);
	try {
		const digest = new Uint8Array(await crypto.subtle.digest("SHA-256", raw));
		return {
			kek: await crypto.subtle.importKey("raw", raw, "AES-GCM", false, ["encrypt", "decrypt"]),
			keyId: `env:${toHex(digest).slice(0, 8)}`,
		};
	} finally {
		raw.fill(0);
	}
}

/**
 * Refuse to boot with the integrations gate on and no usable key. Called once by `apps/web/main.ts`
 * after the env files load, in production too; throws, so the server never starts listening.
 */
export function assertVaultKeyAllowed(): void {
	if (isIntegrationsBackendLive() && !vaultKey()) {
		throw new Error(
			"Refusing to start: INTEGRATIONS_BACKEND_LIVE is on, but ENCRYPTION_KEY is missing, a " +
				"placeholder or not 32 bytes of hex.",
		);
	}
}

/** The `key_id` new rows record: `env:` + the first 8 hex of sha256(the current KEK). */
export async function activeKeyId(): Promise<string> {
	return (await loadKek()).keyId;
}

// #endregion

// #region Operations

/**
 * Seal one row's credentials under a fresh DEK.
 *
 * Refuses while the integrations gate is off rather than returning a reversible encoding: a stub that
 * base64s a token and calls it sealed writes a row indistinguishable from a real one, which would
 * survive the gate flip as plaintext in a table nobody looks inside.
 */
export async function seal(
	connectionId: string,
	plaintexts: SecretPlaintexts,
): Promise<SealedSecret> {
	if (!isIntegrationsBackendLive()) {
		throw new Error("token-vault: sealing is disabled while INTEGRATIONS_BACKEND_LIVE is off.");
	}
	const { kek, keyId } = await loadKek();
	const dek = crypto.getRandomValues(new Uint8Array(32));
	try {
		const key = await crypto.subtle.importKey("raw", dek, "AES-GCM", false, ["encrypt"]);
		const wrapNonce = randomNonce();
		const sealed: SealedSecret = {
			key_id: keyId,
			wrapped_dek: await gcmSeal(kek, wrapNonce, dek),
			wrapped_dek_nonce: toBytea(wrapNonce),
			access_token_cipher: null,
			nonce: null,
			refresh_token_cipher: null,
			refresh_token_nonce: null,
			api_secret_cipher: null,
			api_secret_nonce: null,
		};
		for (const kind of KINDS) {
			const plaintext = plaintexts[kind];
			if (plaintext === undefined) continue;
			const nonce = randomNonce();
			const [cipherColumn, nonceColumn] = COLUMNS[kind];
			sealed[cipherColumn] = await gcmSeal(
				key,
				nonce,
				encoder.encode(plaintext),
				aad(connectionId, kind, keyId),
			);
			sealed[nonceColumn] = toBytea(nonce);
		}
		return sealed;
	} finally {
		dek.fill(0);
	}
}

/**
 * Open one credential of a sealed row, or `null` when the row holds none of that kind.
 *
 * The plaintext must never be returned to a route, echoed into a `ServiceResult`, written to a log
 * line, or attached to an error. A row under another key refuses; a failed tag is a tamper signal and
 * throws, never a partial read.
 */
export async function unseal(
	connectionId: string,
	secret: SealedSecret,
	kind: SecretKind,
): Promise<string | null> {
	if (!isIntegrationsBackendLive()) {
		throw new Error("token-vault: unsealing is disabled while INTEGRATIONS_BACKEND_LIVE is off.");
	}
	const { kek, keyId } = await loadKek();
	if (secret.key_id !== keyId) {
		throw new Error(
			`token-vault: this row was sealed under ${secret.key_id}, not the current key.`,
		);
	}
	const [cipherColumn, nonceColumn] = COLUMNS[kind];
	const cipher = secret[cipherColumn];
	const nonce = secret[nonceColumn];
	if (!cipher || !nonce) return null;

	let dek: Uint8Array<ArrayBuffer> | null = null;
	try {
		dek = new Uint8Array(
			await crypto.subtle.decrypt(
				{ name: "AES-GCM", iv: fromBytea(secret.wrapped_dek_nonce) },
				kek,
				fromBytea(secret.wrapped_dek),
			),
		);
		const key = await crypto.subtle.importKey("raw", dek, "AES-GCM", false, ["decrypt"]);
		return decoder.decode(
			await crypto.subtle.decrypt(
				{
					name: "AES-GCM",
					iv: fromBytea(nonce),
					additionalData: aad(connectionId, kind, keyId),
				},
				key,
				fromBytea(cipher),
			),
		);
	} catch {
		throw new Error(`token-vault: the ${kind} failed its tag check; the row was altered.`);
	} finally {
		dek?.fill(0);
	}
}

// #endregion
