import { z } from "zod";

/**
 * `integrations` schema shapes — the Zod SSOT for third-party OAuth connections.
 *
 * Mirrors migration `20260724101000_integrations_connections.sql`, the first tables in the
 * `integrations` schema (declared empty since `0001_init_schemas.sql`). Two concerns live here:
 * the **provider catalogue** (which third parties are integrable and what they can do) and a
 * user's **stored authorization** to act on their behalf at one of them.
 *
 * ⚠️ **Authentication ≠ authorization.** The Google OAuth in `apps/web/features/auth/` is
 * _sign-in_: GoTrue owns it and no third-party API token is retained. These shapes model a
 * separate, additional consent — a long-lived API grant the platform stores so it can read
 * free/busy or mint a meeting room later. Never conflate the two flows or their token stores.
 *
 * ⚠️ **No secret ever appears in this file.** The migration's `access_token_cipher` /
 * `refresh_token_cipher` columns are deliberately absent from every schema below: the base table is
 * definer-only and clients read `integrations.v_my_connections`, which cannot project a token.
 * {@link UserConnectionSchema} mirrors that view, not the table.
 */

// #region Scalars
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
/** An opaque UUID id. */
export const uuid = z.string().regex(UUID_RE, "Expected a UUID.");
/** An ISO timestamp string as returned by PostgREST. */
export const timestamp = z.string();
// #endregion

// #region Vocabulary
/**
 * `integrations.provider_kind` — what a connection can be used FOR.
 *
 * These are two genuinely separate axes and must not be collapsed: **calendar** is free/busy sync
 * (the chips `@projective/types/scheduling` `INTEGRATION_SOURCES` already advertises), **
 * conferencing** is meeting-room generation (SYSTEM_ARCHITECTURE.md §Conferencing). A provider may
 * hold both — Google mints a Meet room through the Calendar API — which is why the catalogue row
 * carries an array rather than a single value.
 */
export const ProviderKind = z.enum(["calendar", "conferencing"]);
export type ProviderKind = z.infer<typeof ProviderKind>;

/**
 * `integrations.connection_status`. `expired` is recoverable by a token refresh; `revoked` is
 * terminal for that row and needs a fresh consent. Nothing is hard-deleted (root CLAUDE.md §5).
 */
export const ConnectionStatus = z.enum(["active", "expired", "revoked", "error"]);
export type ConnectionStatus = z.infer<typeof ConnectionStatus>;

/** `integrations.connection_action` — the consent-trail vocabulary. */
export const ConnectionAction = z.enum([
	"connected",
	"refreshed",
	"scope_changed",
	"expired",
	"revoked",
	"error",
	"synced",
]);
export type ConnectionAction = z.infer<typeof ConnectionAction>;

/**
 * The seeded provider slugs. The five calendar sources match
 * `@projective/types/scheduling` `INTEGRATION_SOURCES` exactly (one vocabulary, not two); the
 * conferencing-only slugs are additive.
 */
export const PROVIDER_SLUGS = [
	"google",
	"outlook",
	"apple",
	"samsung",
	"notion",
	"zoom",
	"microsoft_teams",
	"discord",
] as const;
export type ProviderSlug = (typeof PROVIDER_SLUGS)[number];

/**
 * A provider slug. Kept as a bounded string rather than a closed enum so the catalogue stays a
 * DATA table — a new provider is a seed row, not a migration + a type change.
 */
export const providerSlug = z.string().min(1).max(40);
// #endregion

// #region Rows
/** A row of `integrations.providers` — the public, non-sensitive third-party catalogue. */
export const IntegrationProviderSchema = z.object({
	slug: providerSlug,
	label: z.string().max(60),
	capabilities: z.array(ProviderKind),
	isEnabled: z.boolean(),
	/** Scopes requested at consent time. Documentation/config only — never a credential. */
	defaultScopes: z.array(z.string().max(200)),
	docsUrl: z.string().max(400).nullable(),
	createdAt: timestamp,
});
export type IntegrationProvider = z.infer<typeof IntegrationProviderSchema>;

/**
 * A row of `integrations.v_my_connections` — the caller's own connections, token columns excluded
 * by construction. This is the ONLY connection shape a client ever sees.
 */
export const UserConnectionSchema = z.object({
	id: uuid,
	userId: uuid,
	providerSlug: providerSlug,
	providerLabel: z.string().max(60),
	providerCapabilities: z.array(ProviderKind),
	status: ConnectionStatus,
	/** What this consent actually granted — may be narrower than the provider's defaults. */
	grantedKinds: z.array(ProviderKind),
	grantedScopes: z.array(z.string().max(200)),
	/** Which account at the far end is linked (usually an email). Visible only to its owner. */
	externalAccountLabel: z.string().max(200).nullable(),
	tokenExpiresAt: timestamp.nullable(),
	lastSyncedAt: timestamp.nullable(),
	lastError: z.string().max(500).nullable(),
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
	kinds: z.array(ProviderKind).max(2).optional(),
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
/** Human labels for the seeded providers. Mirrors the `integrations.providers` seed rows. */
export const PROVIDER_LABEL: Record<ProviderSlug, string> = {
	google: "Google",
	outlook: "Outlook",
	apple: "Apple",
	samsung: "Samsung",
	notion: "Notion",
	zoom: "Zoom",
	microsoft_teams: "Microsoft Teams",
	discord: "Discord",
};

/** Does this connection currently authorize the given capability? Pure, total. */
export function connectionSupports(connection: UserConnection, kind: ProviderKind): boolean {
	return connection.status === "active" && connection.grantedKinds.includes(kind);
}
// #endregion
