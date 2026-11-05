import { z } from "zod";
import { timestamp, uuid } from "./common.ts";

/**
 * The token vault's row: ciphertext and envelope metadata, never a plaintext.
 *
 * ⚠️ **Server-only.** `integrations.connection_secrets` has RLS on, no policy, no view and no client
 * grant. These shapes exist so `token-vault.ts` and the definers in `00001500` agree on the columns;
 * no `/api/*` response may carry one. Keys are the columns' own names and every `bytea` is the `\x…`
 * hex PostgREST carries, because this is the row, not a projection of it.
 *
 * @module
 */

// #region Vault row
const bytea = z.string().regex(/^\\x(?:[0-9a-f]{2})*$/);

/** What `seal()` produces: the envelope columns of one `connection_secrets` row. */
export const SealedSecretSchema = z.object({
	/** `env:` + the first 8 hex of sha256(the KEK). `unseal()` refuses any other key's row. */
	key_id: z.string().regex(/^env:[0-9a-f]{8}$/),
	/** The row's DEK, sealed under the KEK. Includes its GCM tag. */
	wrapped_dek: bytea,
	wrapped_dek_nonce: bytea,
	access_token_cipher: bytea.nullable(),
	/** The access token's nonce (the column predates the other two). */
	nonce: bytea.nullable(),
	refresh_token_cipher: bytea.nullable(),
	refresh_token_nonce: bytea.nullable(),
	/** An S3-compatible secret access key, or an API key. */
	api_secret_cipher: bytea.nullable(),
	api_secret_nonce: bytea.nullable(),
});
export type SealedSecret = z.infer<typeof SealedSecretSchema>;

/** A whole row of `integrations.connection_secrets`. */
export const ConnectionSecretRowSchema = SealedSecretSchema.extend({
	connection_id: uuid,
	token_type: z.string(),
	access_token_expires_at: timestamp.nullable(),
	refresh_token_expires_at: timestamp.nullable(),
	encryption_alg: z.string(),
	rotated_at: timestamp.nullable(),
	created_at: timestamp,
	updated_at: timestamp,
});
export type ConnectionSecretRow = z.infer<typeof ConnectionSecretRowSchema>;
// #endregion
