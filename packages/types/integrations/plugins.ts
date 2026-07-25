import { z } from "zod";
import { timestamp, uuid } from "./common.ts";

/**
 * The PLUGIN ecosystem shapes — the developer registry, versions, the extension-point + scope
 * catalogues, and per-user/workspace installations ("Projective OS").
 *
 * Post-MVP by roadmap, but the shapes are defined now so the later build is not a rewrite. The
 * trust model is adversarial (Figma/Shopify, NOT Obsidian): third-party code never runs in the
 * host origin, and every data touch is mediated against the installation's consented capability
 * scopes. Backs the `integrations` plugin tables; see SYSTEM_ARCHITECTURE.md §Plugin Ecosystem.
 *
 * @module
 */

// #region Vocabulary
/** `integrations.plugin_status` — a plugin's marketplace lifecycle (`delisted` is the archived terminal). */
export const PluginStatus = z.enum([
	"draft",
	"submitted",
	"in_review",
	"approved",
	"published",
	"suspended",
	"delisted",
]);
export type PluginStatus = z.infer<typeof PluginStatus>;

/** `integrations.plugin_version_status` — one version's review/publish state. */
export const PluginVersionStatus = z.enum([
	"draft",
	"submitted",
	"in_review",
	"approved",
	"published",
	"deprecated",
	"yanked",
]);
export type PluginVersionStatus = z.infer<typeof PluginVersionStatus>;

/**
 * `integrations.plugin_runtime` — the isolation/UI model. `iframe` = sandboxed cross-origin UI
 * (zero-trust default); `declarative` = a host-rendered Block-Kit-style descriptor (no third-party
 * code in our origin); `headless` = no UI, server/automation only.
 */
export const PluginRuntime = z.enum(["iframe", "declarative", "headless"]);
export type PluginRuntime = z.infer<typeof PluginRuntime>;

/** `integrations.plugin_surface` — the KIND of extension point a plugin contributes to. */
export const PluginSurface = z.enum([
	"page_tab",
	"panel",
	"dashboard_widget",
	"sidebar_item",
	"command",
	"settings_section",
	"automation_action",
]);
export type PluginSurface = z.infer<typeof PluginSurface>;

/** `integrations.install_status` — a per-user/workspace installation's state. */
export const InstallStatus = z.enum(["active", "disabled", "revoked"]);
export type InstallStatus = z.infer<typeof InstallStatus>;

/** `integrations.install_scope` — WHERE an installation runs (mirrors the owner axis). */
export const InstallScope = z.enum(["user", "team", "business", "organisation"]);
export type InstallScope = z.infer<typeof InstallScope>;

/** `integrations.scope_risk` — how loudly the consent UI surfaces a requested Plugin-API scope. */
export const ScopeRisk = z.enum(["low", "medium", "high"]);
export type ScopeRisk = z.infer<typeof ScopeRisk>;

/** `integrations.plugin_action` — the install/consent/invocation audit vocabulary. */
export const PluginAction = z.enum([
	"installed",
	"updated",
	"enabled",
	"disabled",
	"uninstalled",
	"scope_granted",
	"scope_revoked",
	"version_pinned",
	"invoked",
	"api_call",
	"error",
]);
export type PluginAction = z.infer<typeof PluginAction>;

/** A Plugin-API capability scope key, e.g. `read:messages`. Kept a bounded string (DATA table). */
export const pluginScopeKey = z.string().min(1).max(64);
/** An extension-point key, e.g. `messages.tab`. */
export const extensionPointKey = z.string().min(1).max(64);
// #endregion

// #region Catalogue rows
/** A row of `integrations.extension_points` — a surface a plugin may inject into. */
export const ExtensionPointSchema = z.object({
	key: extensionPointKey,
	surface: PluginSurface,
	label: z.string().max(80),
	description: z.string().max(400).nullable(),
	allowedRuntimes: z.array(PluginRuntime),
	isEnabled: z.boolean(),
	createdAt: timestamp,
});
export type ExtensionPoint = z.infer<typeof ExtensionPointSchema>;

/** A row of `integrations.plugin_scopes` — one Plugin-API permission a plugin may request. */
export const PluginScopeSchema = z.object({
	key: pluginScopeKey,
	label: z.string().max(80),
	description: z.string().max(400).nullable(),
	domain: z.string().max(40),
	risk: ScopeRisk,
	createdAt: timestamp,
});
export type PluginScope = z.infer<typeof PluginScopeSchema>;
// #endregion

// #region Plugin & version rows
/** A row of `integrations.plugins` — the developer registry entry. */
export const PluginSchema = z.object({
	id: uuid,
	slug: z.string().min(1).max(60),
	name: z.string().max(80),
	tagline: z.string().max(160).nullable(),
	description: z.string().nullable(),
	developerUserId: uuid.nullable(),
	developerName: z.string().max(80).nullable(),
	homepageUrl: z.string().max(400).nullable(),
	repoUrl: z.string().max(400).nullable(),
	iconUrl: z.string().max(400).nullable(),
	category: z.string().max(40).nullable(),
	status: PluginStatus,
	runtime: PluginRuntime,
	isVerified: z.boolean(),
	installCount: z.number().int(),
	createdAt: timestamp,
	updatedAt: timestamp,
});
export type Plugin = z.infer<typeof PluginSchema>;

/**
 * The declared plugin MANIFEST (the jsonb on a version). The source of truth for what a version
 * contributes and asks for. Validated at submission and re-checked at install time.
 */
export const PluginManifestSchema = z.object({
	/** The extension points this version renders into. */
	surfaces: z.array(
		z.object({
			extensionPoint: extensionPointKey,
			runtime: PluginRuntime,
			/** The sandboxed entry (an iframe path, or a declarative component id). */
			entry: z.string().max(200),
			title: z.string().max(80).optional(),
		}),
	).default([]),
	/** The capability scopes the version requests. */
	scopes: z.array(pluginScopeKey).default([]),
	/** Optional JSON-schema-ish description of the plugin's own config surface. */
	config: z.record(z.string(), z.unknown()).optional(),
});
export type PluginManifest = z.infer<typeof PluginManifestSchema>;

/** A row of `integrations.plugin_versions`. */
export const PluginVersionSchema = z.object({
	id: uuid,
	pluginId: uuid,
	semver: z.string().max(40),
	status: PluginVersionStatus,
	runtime: PluginRuntime,
	manifest: PluginManifestSchema,
	bundleUrl: z.string().max(400).nullable(),
	bundleIntegrity: z.string().max(200).nullable(),
	sourceCommit: z.string().max(80).nullable(),
	requestedScopes: z.array(pluginScopeKey),
	minPlatformVersion: z.string().max(40).nullable(),
	changelog: z.string().nullable(),
	reviewedBy: uuid.nullable(),
	submittedAt: timestamp.nullable(),
	approvedAt: timestamp.nullable(),
	publishedAt: timestamp.nullable(),
	createdAt: timestamp,
});
export type PluginVersion = z.infer<typeof PluginVersionSchema>;

/**
 * A row of `integrations.v_plugin_catalog` — a published plugin joined to its latest published
 * version. The public marketplace listing shape.
 */
export const PluginCatalogEntrySchema = z.object({
	id: uuid,
	slug: z.string().max(60),
	name: z.string().max(80),
	tagline: z.string().max(160).nullable(),
	description: z.string().nullable(),
	developerName: z.string().max(80).nullable(),
	category: z.string().max(40).nullable(),
	runtime: PluginRuntime,
	iconUrl: z.string().max(400).nullable(),
	homepageUrl: z.string().max(400).nullable(),
	repoUrl: z.string().max(400).nullable(),
	status: PluginStatus,
	isVerified: z.boolean(),
	installCount: z.number().int(),
	latestVersionId: uuid.nullable(),
	latestSemver: z.string().max(40).nullable(),
	latestRequestedScopes: z.array(pluginScopeKey).nullable(),
	latestPublishedAt: timestamp.nullable(),
});
export type PluginCatalogEntry = z.infer<typeof PluginCatalogEntrySchema>;
// #endregion

// #region Installation rows
/** A row of `integrations.plugin_installations` — a user's install with its consented scopes. */
export const PluginInstallationSchema = z.object({
	id: uuid,
	pluginId: uuid,
	versionId: uuid,
	installerUserId: uuid,
	installScope: InstallScope,
	ownerId: uuid.nullable(),
	status: InstallStatus,
	grantedScopes: z.array(pluginScopeKey),
	config: z.record(z.string(), z.unknown()),
	autoUpdate: z.boolean(),
	installedAt: timestamp,
	disabledAt: timestamp.nullable(),
	revokedAt: timestamp.nullable(),
	updatedAt: timestamp,
});
export type PluginInstallation = z.infer<typeof PluginInstallationSchema>;

/** A row of `integrations.plugin_audit`. */
export const PluginAuditEntrySchema = z.object({
	id: uuid,
	pluginId: uuid.nullable(),
	installationId: uuid.nullable(),
	userId: uuid,
	action: PluginAction,
	detail: z.string().max(500).nullable(),
	createdAt: timestamp,
});
export type PluginAuditEntry = z.infer<typeof PluginAuditEntrySchema>;
// #endregion

// #region Payloads
/** Install a plugin: pin a version and consent to a subset of its requested scopes. */
export const InstallPluginSchema = z.object({
	pluginId: uuid,
	versionId: uuid,
	installScope: InstallScope.default("user"),
	ownerId: uuid.optional(),
	grantedScopes: z.array(pluginScopeKey).default([]),
	autoUpdate: z.boolean().default(false),
});
export type InstallPlugin = z.infer<typeof InstallPluginSchema>;

/** Update an installation — re-consent scopes, toggle enable, pin a version, or edit config. */
export const UpdateInstallationSchema = z.object({
	installationId: uuid,
	status: InstallStatus.optional(),
	versionId: uuid.optional(),
	grantedScopes: z.array(pluginScopeKey).optional(),
	config: z.record(z.string(), z.unknown()).optional(),
	autoUpdate: z.boolean().optional(),
});
export type UpdateInstallation = z.infer<typeof UpdateInstallationSchema>;

/** The marketplace listing payload (Settings → Integrations → Plugins). */
export const PluginMarketplaceViewSchema = z.object({
	plugins: z.array(PluginCatalogEntrySchema),
	installations: z.array(PluginInstallationSchema),
	scopes: z.array(PluginScopeSchema),
	extensionPoints: z.array(ExtensionPointSchema),
});
export type PluginMarketplaceView = z.infer<typeof PluginMarketplaceViewSchema>;
// #endregion

// #region Helpers
/** Is a plugin installed and active for the viewer? Pure, total. */
export function installIsActive(install: PluginInstallation): boolean {
	return install.status === "active";
}

/** Does an active installation carry a given capability scope? Pure, total. */
export function installHasScope(install: PluginInstallation, scope: string): boolean {
	return install.status === "active" && install.grantedScopes.includes(scope);
}
// #endregion
