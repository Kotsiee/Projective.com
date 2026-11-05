import { z } from "zod";
import { timestamp } from "./common.ts";

/**
 * The provider CATALOGUE — the public, non-sensitive `integrations.providers` rows plus the
 * vocabulary the whole connector subsystem is built on.
 *
 * ⚠️ **Authentication ≠ authorization.** The Google OAuth in `apps/web/features/auth/` is _sign-in_
 * (GoTrue owns it; no third-party API token is retained). These shapes model a separate, additional
 * consent — a long-lived API grant the platform stores to read free/busy, sync a drive, mint a
 * meeting room. Never conflate the two flows or their token stores.
 *
 * @module
 */

// #region Capability & category axes
/**
 * `integrations.provider_kind` — the fine-grained CAPABILITY axis: what a connection is authorized
 * to DO. This is the unit of consent (a user may grant `calendar` but not `storage` at the same
 * vendor), so it is what a connection's `grantedKinds` records — never collapse two of these into
 * one chip. `calendar`/`conferencing` match `@projective/types/scheduling` `INTEGRATION_SOURCES`.
 */
export const ProviderKind = z.enum([
	"calendar",
	"conferencing",
	"freebusy",
	"storage",
	"docs",
	"contacts",
	"code",
	"issues",
	"crm",
	"messaging",
	"identity",
	"payments",
]);
export type ProviderKind = z.infer<typeof ProviderKind>;

/**
 * `integrations.provider_category` — the coarse FAMILY axis: how the catalogue groups a vendor in
 * the UI. One value per provider, distinct from the multi-valued {@link ProviderKind} capability
 * array a provider advertises.
 */
export const ProviderCategory = z.enum([
	"identity",
	"payments",
	"calendar",
	"conferencing",
	"storage",
	"productivity",
	"developer",
	"crm",
	"communication",
	"automation",
]);
export type ProviderCategory = z.infer<typeof ProviderCategory>;

/**
 * `integrations.auth_scheme` — how the platform obtains authorization at a provider.
 *
 * `aws_sigv4` is not an OAuth variant and does not fit the consent model the others share: there is no
 * authorization server, no redirect and no refresh — the user supplies a key pair (or an assumable role)
 * that the platform signs every request with. It is a distinct member precisely so the connect flow can
 * branch on it instead of pretending a credential form is a consent screen.
 */
export const AuthScheme = z.enum([
	"oauth2",
	"oauth1",
	"api_key",
	"app_password",
	"none",
	"aws_sigv4",
]);
export type AuthScheme = z.infer<typeof AuthScheme>;

/**
 * Which broker fronts a provider — the integration STRATEGY. `direct` = we own the adapter;
 * `nylas` = a unified calendar API; `merge` = a unified CRM/long-tail API. Documents where the
 * adapter layer routes (SYSTEM_ARCHITECTURE.md §Integration & Plugin Platform).
 */
export const ProviderBroker = z.enum(["direct", "nylas", "merge"]);
export type ProviderBroker = z.infer<typeof ProviderBroker>;
// #endregion

// #region Provider slug
/**
 * The seeded provider slugs. Kept in sync with the `00005050` seed. The five original calendar
 * sources match `@projective/types/scheduling` `INTEGRATION_SOURCES`; the rest are additive.
 */
export const PROVIDER_SLUGS = [
	"google",
	"outlook",
	"apple",
	"samsung",
	"calendly",
	"zoom",
	"microsoft_teams",
	"discord",
	"google_drive",
	"dropbox",
	"onedrive",
	"frameio",
	"s3",
	"notion",
	"github",
	"slack",
	"monday",
	"google_contacts",
] as const;
export type ProviderSlug = (typeof PROVIDER_SLUGS)[number];

/**
 * A provider slug. Kept a bounded string, not a closed enum, so the catalogue stays a DATA table —
 * a new provider is a seed row, not a migration plus a type change.
 */
export const providerSlug = z.string().min(1).max(40);
// #endregion

// #region Auth config
/**
 * `integrations.providers.auth_config` — the non-secret half of a provider's OAuth client, so a new
 * connector is a seed row: where consent, tokens and the account's identity are reached. Keys are the
 * stored JSON's own. `{tenant}` in a URL is filled from `MICROSOFT_INTEGRATION_TENANT`. The client
 * secret is never here: it lives in the Environment Variable Contract.
 */
export const ProviderAuthConfigSchema = z.object({
	authorize_url: z.string().startsWith("https://"),
	token_url: z.string().startsWith("https://"),
	/** Absent where the provider has no per-grant revocation (Microsoft). */
	revoke_url: z.string().startsWith("https://").optional(),
	pkce: z.boolean(),
	/** `false` where scopes live on the provider's own app and naming them is refused (Zoom). */
	send_scopes: z.boolean().optional(),
	/** Extra authorize query parameters (Google's `access_type=offline`). */
	authorize_params: z.record(z.string(), z.string()).optional(),
	/** How the client authenticates at the token endpoint. `basic` is Zoom's; absent is the form body. */
	token_auth: z.enum(["body", "basic"]).optional(),
	/** The endpoint that names the linked account, read with the fresh access token. */
	identity_url: z.string().startsWith("https://"),
	/** The identity response's field holding the account's stable id. */
	identity_id_field: z.string().min(1),
	/** The identity response's fields tried, in order, for the account's display label. */
	identity_label_fields: z.array(z.string().min(1)),
	/**
	 * The scopes each capability needs, so a consent asks for what its `kinds` want and a narrowed
	 * grant records only the capabilities it covers. A default scope under no kind is always requested.
	 */
	kind_scopes: z.record(z.string(), z.array(z.string())).optional(),
});
export type ProviderAuthConfig = z.infer<typeof ProviderAuthConfigSchema>;
// #endregion

// #region Rows
/** A row of `integrations.providers` — the public, non-sensitive third-party catalogue. */
export const IntegrationProviderSchema = z.object({
	slug: providerSlug,
	label: z.string().max(60),
	category: ProviderCategory,
	capabilities: z.array(ProviderKind),
	authScheme: AuthScheme,
	/** Whether a person can connect it here: switched on, and with this environment's client behind it. */
	isEnabled: z.boolean(),
	isBeta: z.boolean(),
	broker: ProviderBroker,
	supportsWebhooks: z.boolean(),
	/** Scopes requested at consent time. Documentation/config only — never a credential. */
	defaultScopes: z.array(z.string().max(200)),
	docsUrl: z.string().max(400).nullable(),
	iconUrl: z.string().max(400).nullable(),
	sortOrder: z.number().int(),
	createdAt: timestamp,
});
export type IntegrationProvider = z.infer<typeof IntegrationProviderSchema>;
// #endregion

// #region Helpers
/** Human labels for the seeded providers. Mirrors the `integrations.providers` seed rows. */
export const PROVIDER_LABEL: Record<ProviderSlug, string> = {
	google: "Google",
	outlook: "Outlook",
	apple: "Apple",
	samsung: "Samsung",
	calendly: "Calendly",
	zoom: "Zoom",
	microsoft_teams: "Microsoft Teams",
	discord: "Discord",
	google_drive: "Google Drive",
	dropbox: "Dropbox",
	/** One Microsoft Graph connector: a person's OneDrive, or a SharePoint library by `config.driveId`. */
	onedrive: "OneDrive & SharePoint",
	frameio: "Frame.io",
	/** The vendor-neutral label: the connector speaks the S3 API, which is not only Amazon's. */
	s3: "S3-compatible storage",
	notion: "Notion",
	github: "GitHub",
	slack: "Slack",
	monday: "Monday.com",
	google_contacts: "Google Contacts",
};
// #endregion
