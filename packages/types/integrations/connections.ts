import { z } from "zod";
import { timestamp, uuid } from "./common.ts";
import {
	IntegrationProviderSchema,
	ProviderCategory,
	ProviderKind,
	providerSlug,
} from "./providers.ts";
import { AssetItemSchema } from "../files/assets.ts";
import { AssetFolderSchema } from "../files/folders.ts";

/**
 * User CONNECTIONS — a user's stored authorization to act on their behalf at a provider, and the
 * consent trail around it.
 *
 * ⚠️ **No secret ever appears in this file.** The token vault (`integrations.connection_secrets`)
 * and every operational table (sync state, webhooks) are service-role only and have NO Zod shape
 * here — a client never sees them. {@link UserConnectionSchema} mirrors `v_my_connections`, the
 * definer view that physically cannot project a token column.
 *
 * **Dependency direction (verified, one-way):** {@link DriveBrowsePageSchema} is projected over the
 * files domain's `AssetItem` / `AssetFolder`, so `integrations → files` is a real edge. Nothing under
 * `packages/types/files/**` imports this domain, and nothing there may start to — browsing a connected
 * drive must return the SAME row shape the hub already renders, or the picker needs a second card
 * family and the two drift. That is why the files domain keeps its own local vocabularies for anything
 * it would otherwise reach back for: `ExternalRef.providerSlug` is a bounded string rather than
 * `ProviderSlug`, and `FilesSim.connectionState` restates `connection_status` member for member.
 * Closing that edge would be the TDZ crash class recorded in Decision #49, not a style problem.
 *
 * @module
 */

// #region Vocabulary
/**
 * `integrations.connection_status` — the connection STATE MACHINE. `pending` (consent started, not
 * finished) → `active` → `degraded` (refresh failing but recoverable) → `expired` (recoverable by a
 * refresh) / `revoked` (terminal, needs fresh consent) / `disconnected` (user removed) / `error`.
 * The settings UI shows "reconnect" for the non-`active` recoverable states rather than silently
 * failing.
 */
export const ConnectionStatus = z.enum([
	"pending",
	"active",
	"degraded",
	"expired",
	"revoked",
	"disconnected",
	"error",
]);
export type ConnectionStatus = z.infer<typeof ConnectionStatus>;

/**
 * `integrations.sync_direction`. Read-only `inbound` is the MVP default; `outbound`/`bidirectional`
 * are opt-in per connector (bidirectional carries echo-suppression + conflict cost).
 */
export const SyncDirection = z.enum(["inbound", "outbound", "bidirectional"]);
export type SyncDirection = z.infer<typeof SyncDirection>;

/** `integrations.connection_action` — the consent-trail vocabulary. */
export const ConnectionAction = z.enum([
	"connected",
	"reconnected",
	"refreshed",
	"refresh_failed",
	"scope_changed",
	"sync_started",
	"sync_completed",
	"sync_failed",
	"webhook_registered",
	"webhook_renewed",
	"webhook_expired",
	"expired",
	"revoked",
	"error",
	"synced",
]);
export type ConnectionAction = z.infer<typeof ConnectionAction>;
// #endregion

// #region Rows
/**
 * A row of `integrations.v_my_connections` — the caller's own connections, token columns excluded
 * by construction. This is the ONLY connection shape a client ever sees.
 */
export const UserConnectionSchema = z.object({
	id: uuid,
	userId: uuid,
	providerSlug: providerSlug,
	providerLabel: z.string().max(60),
	providerCategory: ProviderCategory,
	providerCapabilities: z.array(ProviderKind),
	status: ConnectionStatus,
	/** What this consent actually granted — may be narrower than the provider's capabilities. */
	grantedKinds: z.array(ProviderKind),
	grantedScopes: z.array(z.string().max(200)),
	syncDirection: SyncDirection,
	/** Which account at the far end is linked — one user may connect several accounts per provider. */
	externalAccountId: z.string().max(200).nullable(),
	externalAccountLabel: z.string().max(200).nullable(),
	/** Cached, non-secret token expiry so the UI can warn before a refresh is needed. */
	tokenExpiresAt: timestamp.nullable(),
	lastSyncedAt: timestamp.nullable(),
	lastError: z.string().max(500).nullable(),
	errorCount: z.number().int(),
	/**
	 * Non-secret, per-connection settings the adapter needs and OAuth does not carry — an S3 endpoint
	 * and bucket, a Frame.io team id, a Drive shared-drive id. `null` when the provider needs none.
	 *
	 * Deliberately a flat scalar record, not a nested shape: it is projected straight out of a `jsonb`
	 * column, and every provider wants different keys. A provider that needs structure parses this
	 * against its OWN schema (see {@link S3ConnectionConfigSchema}) rather than widening this one.
	 *
	 * ⚠️ Never a credential. Secrets live only in `integrations.connection_secrets`, which is
	 * service-role and has no shape in this package at all — a key that appeared here would be
	 * projected by `v_my_connections` straight to a client.
	 */
	config: z.record(
		z.string().max(80),
		z.union([z.string().max(600), z.number(), z.boolean()]),
	).nullable(),
	connectedAt: timestamp.nullable(),
	revokedAt: timestamp.nullable(),
	createdAt: timestamp,
	updatedAt: timestamp,
});
export type UserConnection = z.infer<typeof UserConnectionSchema>;

/** A row of `integrations.connection_audit` — the consent trail. */
export const ConnectionAuditEntrySchema = z.object({
	id: uuid,
	connectionId: uuid.nullable(),
	userId: uuid,
	providerSlug: providerSlug,
	action: ConnectionAction,
	detail: z.string().max(500).nullable(),
	createdAt: timestamp,
});
export type ConnectionAuditEntry = z.infer<typeof ConnectionAuditEntrySchema>;
// #endregion

// #region Payloads
/** Start an OAuth consent for a provider. The redirect + state are minted server-side. */
export const StartConnectionSchema = z.object({
	providerSlug: providerSlug,
	/** Which capabilities the consent should ask for; defaults to the provider's full set. */
	kinds: z.array(ProviderKind).max(12).optional(),
	/** Read-only by default; a connector may request write/two-way where supported. */
	syncDirection: SyncDirection.optional(),
	/** Where to return the user after consent (a same-origin path, validated server-side). */
	returnTo: z.string().max(400).optional(),
});
export type StartConnection = z.infer<typeof StartConnectionSchema>;

/** Revoke a stored authorization. Terminal — reconnecting requires a fresh consent. */
export const RevokeConnectionSchema = z.object({ connectionId: uuid });
export type RevokeConnection = z.infer<typeof RevokeConnectionSchema>;

/** The connections panel payload (Settings → Integrations). */
export const ConnectionsViewSchema = z.object({
	providers: z.array(IntegrationProviderSchema),
	connections: z.array(UserConnectionSchema),
	/** Convenience projections of `integrations.fn_has_capability`. */
	hasCalendar: z.boolean(),
	hasConferencing: z.boolean(),
	/** The slug that would mint a room today (`integrations.fn_conferencing_provider`), or null. */
	activeConferencingProvider: providerSlug.nullable(),
});
export type ConnectionsView = z.infer<typeof ConnectionsViewSchema>;
// #endregion

// #region Provider configuration
/**
 * The `config` shape an `s3` connection carries.
 *
 * S3 is the one storage connector with no authorization server, so everything an adapter needs to
 * address the bucket has to be stated up front rather than discovered from a token. Parse a
 * connection's `config` against this before using it; the generic scalar record on
 * {@link UserConnectionSchema} deliberately does not encode these keys, because a second provider's
 * config would then have to satisfy them too.
 *
 * ⚠️ There is no access key or secret here. Those are `integrations.connection_secrets` and never
 * cross to a client.
 */
export const S3ConnectionConfigSchema = z.object({
	/** Custom endpoint for an S3-compatible provider (R2, MinIO, Wasabi); `null` = AWS. */
	endpoint: z.string().max(400).nullable(),
	region: z.string().min(1).max(40),
	bucket: z.string().min(1).max(200),
	/** Key prefix the connection is scoped to — the tenant boundary within a shared bucket. */
	prefix: z.string().max(400),
	/**
	 * Address objects as `endpoint/bucket/key` instead of `bucket.endpoint/key`. Required by most
	 * self-hosted S3-compatible servers, where the virtual-host form has no DNS to resolve.
	 */
	pathStyle: z.boolean(),
});
export type S3ConnectionConfig = z.infer<typeof S3ConnectionConfigSchema>;
// #endregion

// #region Drive browsing
/**
 * Browse one level of a connected drive.
 *
 * `folderId` is the provider's OWN id (a Drive file id, a Frame.io asset id) and `path` the
 * slash-delimited key prefix used by providers that have no folder objects at all (S3). Both are
 * accepted because the two families genuinely address a location differently, and normalising one into
 * the other would either invent ids or lose the prefix.
 */
export const DriveBrowseParamsSchema = z.object({
	connectionId: uuid,
	/** The provider's folder id; `null`/absent = the drive root. */
	folderId: z.string().max(200).nullable().optional(),
	/** A key prefix, for prefix-addressed providers; `null`/absent = the root. */
	path: z.string().max(1024).nullable().optional(),
	/** The provider's own paging token, passed back verbatim — never re-derived. */
	cursor: z.string().max(600).nullable().optional(),
	limit: z.number().int().min(1).max(200).optional(),
});
export type DriveBrowseParams = z.infer<typeof DriveBrowseParamsSchema>;

/**
 * One level of a connected drive, projected into the SAME shapes the `/files` hub already renders.
 *
 * Returning `AssetItem` / `AssetFolder` rather than a connector-specific row is the whole point: the
 * picker, the grid, the table and the preview modal are then literally the same components, and a
 * mounted Drive file and a hub-native upload cannot drift apart in how they are drawn. A mounted entry
 * carries `source !== "supabase"`, its `external` back-reference, and `sizeBytes` counted against the
 * PROVIDER's quota, not ours (see `consumesQuota`).
 *
 * Paging is the provider's, not ours: `nextCursor` is their opaque token echoed back, because a
 * connector that pages by continuation token cannot be resumed from an id we invented.
 */
export const DriveBrowsePageSchema = z.object({
	entries: z.array(AssetItemSchema),
	folders: z.array(AssetFolderSchema),
	hasMore: z.boolean(),
	nextCursor: z.string().max(600).nullable(),
});
export type DriveBrowsePage = z.infer<typeof DriveBrowsePageSchema>;
// #endregion

// #region Helpers
/** Does this connection currently authorize the given capability? Pure, total. */
export function connectionSupports(connection: UserConnection, kind: ProviderKind): boolean {
	return connection.status === "active" && connection.grantedKinds.includes(kind);
}

/** Is a connection in a state the user can recover by reconnecting (rather than a fresh consent)? */
export function connectionIsRecoverable(status: ConnectionStatus): boolean {
	return status === "expired" || status === "degraded";
}
// #endregion
