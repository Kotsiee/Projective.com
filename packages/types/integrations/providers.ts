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

// #region Rows
/** A row of `integrations.providers` — the public, non-sensitive third-party catalogue. */
export const IntegrationProviderSchema = z.object({
	slug: providerSlug,
	label: z.string().max(60),
	category: ProviderCategory,
	capabilities: z.array(ProviderKind),
	authScheme: AuthScheme,
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
