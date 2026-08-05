import { isIntegrationsBackendLive } from "../../core/supabase.ts";

/**
 * token-vault — envelope encryption for `integrations.connection_secrets`.
 *
 * **SERVICE-ROLE ONLY.** That table has RLS on, no policy and no `authenticated` grant, and it is
 * projected by no view. Column safety is therefore STRUCTURAL, not a policy that could be loosened: a
 * client reads connections through `integrations.v_my_connections`, which physically cannot project a
 * token column. Nothing in this module may be reachable from a route that runs under a user's JWT.
 *
 * ### Envelope encryption, and why it is not a single key
 *
 * A data-encryption key (DEK) is generated per SECRET, used to encrypt the token, and is itself
 * encrypted by a key-encryption key (KEK) held in a KMS. Only the wrapped DEK and the KEK's `key_id`
 * are stored, so:
 *
 * * rotating the KEK re-wraps DEKs and never touches ciphertext — with one process-wide key, rotation
 *   means decrypting and re-encrypting every row, which is exactly the migration nobody runs;
 * * the plaintext KEK never exists in application memory, so a heap dump or a log of the process
 *   environment does not yield a key that opens every token on the platform;
 * * `key_id` on each row records WHICH KEK wrapped it, so old and new coexist during a rotation instead
 *   of the rotation being a flag day.
 *
 * ### ⚠️ FLAGGED CONTRADICTION — do not resolve here (Decision #59)
 *
 * The documented Environment Variable Contract carries an **`ENCRYPTION_KEY`** — a single, symmetric,
 * process-wide secret. That is a DIFFERENT design from the KMS envelope the `integrations` schema was
 * built for (`connection_secrets.key_id` exists precisely because the wrapping key is external and
 * rotatable). The two cannot both be right:
 *
 * * if `ENCRYPTION_KEY` is authoritative, `key_id` is decoration and rotation is a full-table rewrite;
 * * if the envelope design is authoritative, `ENCRYPTION_KEY` needs to be removed from the contract, or
 *   redefined as a local development KEK that is never used in production.
 *
 * This module implements the ENVELOPE interface, because that is what the schema requires and it is the
 * one that can absorb the other. It does not pick a winner. A human decides, and the env contract is
 * updated in the same change. Any key material below is an `XXXX-XXXX` placeholder per root CLAUDE.md
 * §6 — a real key is never committed.
 */

// #region Placeholders

/** The KMS key alias the KEK is resolved through. Placeholder per root CLAUDE.md §6. */
export const KMS_KEY_ALIAS_PLACEHOLDER = "XXXX-XXXX";

/** The `key_id` a newly wrapped secret records. Placeholder until the KMS is provisioned. */
export const ACTIVE_KEY_ID_PLACEHOLDER = "XXXX-XXXX";

// #endregion

// #region Shapes

/** An enveloped secret, exactly as `integrations.connection_secrets` stores it. */
export interface SealedSecret {
	/** Which KEK wrapped the DEK — the column that makes rotation incremental instead of a flag day. */
	keyId: string;
	/** The DEK, encrypted by the KEK. Base64. */
	wrappedKey: string;
	/** The token, encrypted by the DEK. Base64. */
	ciphertext: string;
	/** The AEAD nonce. Base64. Never reused with the same DEK. */
	iv: string;
	/** The AEAD authentication tag. Base64. */
	tag: string;
}

/** Which credential a sealed row holds. */
export type SecretKind = "access_token" | "refresh_token" | "api_key" | "aws_secret_access_key";

// #endregion

// #region Operations

/**
 * The active key id new secrets are wrapped under.
 *
 * Read at call time, never captured at import: a rotation must take effect on the next write without a
 * process restart, and a module-level capture is how a rotated key silently keeps writing the old one.
 */
export function activeKeyId(): string {
	return ACTIVE_KEY_ID_PLACEHOLDER;
}

/**
 * Wrap a plaintext credential for storage.
 *
 * Stub-first behind {@link isIntegrationsBackendLive}: with the gate off it **refuses** rather than
 * returning a reversible encoding. That is deliberate. A stub that base64s a token and calls it sealed
 * is worse than one that throws, because the row it writes is indistinguishable from a real one and
 * would survive the gate flip as plaintext in a table nobody looks inside.
 */
export function seal(_plaintext: string, _kind: SecretKind): Promise<SealedSecret> {
	if (!isIntegrationsBackendLive()) {
		return Promise.reject(
			new Error(
				"token-vault: sealing is disabled while INTEGRATIONS_BACKEND_LIVE is off. " +
					"No credential may be stored until the KMS envelope is provisioned.",
			),
		);
	}
	// LIVE: generate a 256-bit DEK → AES-256-GCM the plaintext under it → ask the KMS to wrap the DEK
	// under the KEK named by KMS_KEY_ALIAS_PLACEHOLDER → return { keyId, wrappedKey, ciphertext, iv,
	// tag }. The DEK is zeroed immediately after use and is never logged, returned or cached.
	return Promise.reject(new Error("token-vault: KMS envelope encryption is not yet provisioned."));
}

/**
 * Unwrap a sealed credential.
 *
 * The plaintext must never be returned to a route, echoed into a `ServiceResult`, written to a log line,
 * or attached to an error. The only legitimate consumer is a {@link StorageAdapter} construction, which
 * takes it as `accessToken` and holds it for the duration of one request.
 */
export function unseal(_secret: SealedSecret): Promise<string> {
	if (!isIntegrationsBackendLive()) {
		return Promise.reject(
			new Error("token-vault: unsealing is disabled while INTEGRATIONS_BACKEND_LIVE is off."),
		);
	}
	// LIVE: ask the KMS to unwrap `wrappedKey` under the KEK named by `keyId` (NOT under the active key
	// — that is the whole point of storing it per row) → AES-256-GCM open `ciphertext` with `iv`/`tag`.
	// A tag mismatch is a tamper signal and must fail loudly, never fall back to a partial read.
	return Promise.reject(new Error("token-vault: KMS envelope encryption is not yet provisioned."));
}

/**
 * Re-wrap a secret under the current KEK without touching its ciphertext.
 *
 * The operation a rotation actually performs: the DEK is unwrapped under the OLD `keyId` and re-wrapped
 * under the new one, so the encrypted token is never decrypted and never rewritten. This is the property
 * a single process-wide `ENCRYPTION_KEY` cannot provide, and the concrete reason the flagged
 * contradiction above matters.
 */
export function rewrap(_secret: SealedSecret): Promise<SealedSecret> {
	if (!isIntegrationsBackendLive()) {
		return Promise.reject(
			new Error("token-vault: rewrap is disabled while INTEGRATIONS_BACKEND_LIVE is off."),
		);
	}
	return Promise.reject(new Error("token-vault: KMS envelope encryption is not yet provisioned."));
}

// #endregion
