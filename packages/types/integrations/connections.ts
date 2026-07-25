import { z } from "zod";
import { timestamp, uuid } from "./common.ts";
import {
	IntegrationProviderSchema,
	ProviderCategory,
	ProviderKind,
	providerSlug,
} from "./providers.ts";

/**
 * User CONNECTIONS — a user's stored authorization to act on their behalf at a provider, and the
 * consent trail around it.
 *
 * ⚠️ **No secret ever appears in this file.** The token vault (`integrations.connection_secrets`)
 * and every operational table (sync state, webhooks) are service-role only and have NO Zod shape
 * here — a client never sees them. {@link UserConnectionSchema} mirrors `v_my_connections`, the
 * definer view that physically cannot project a token column.
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
