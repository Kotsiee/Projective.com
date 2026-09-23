import type { AssetItem } from "@projective/types/files";
import type {
	ConnectionsView,
	DriveBrowsePage,
	DriveBrowseParams,
	IntegrationProvider,
	RevokeConnection,
	StartConnection,
	UserConnection,
} from "@projective/types/integrations";
import { connectionIsRecoverable, connectionSupports } from "@projective/types/integrations";
import { fail, ok, type ServiceResult } from "../ServiceResult.ts";
import { getAnonClient, getServiceClient, getUserClient } from "../../core/supabase.ts";
import { canReadLive, type ReadActor } from "../read-actor.ts";
import { mayFileInto } from "../files/live-library.ts";

/**
 * IntegrationsBackendService — the FAT half of the connector subsystem: the provider catalogue, a
 * user's stored authorizations, the consent handshake, browsing a connected drive, and mounting one of
 * its objects into the `/files` hub.
 *
 * The catalogue and the caller's connections are read LIVE — the providers table (public reference
 * data) and `integrations.v_my_connections`, the definer view that physically cannot project a token
 * column, so no credential can reach a response even by mistake.
 *
 * Connecting is where this deployment stops, and it says so rather than pretending: a consent needs a
 * provider's OAuth client registered in the environment and the token vault's envelope key
 * (`./token-vault.ts`, which refuses to seal until one is configured). No provider is enabled in the
 * catalogue today, so {@link startConnection} answers that the provider is not available, and browsing
 * or mounting — which would carry a stored credential out of the process — answers that connected
 * drives are not available here. A refusal in words is the honest state; a simulated drive is not.
 *
 * ### Rules this service holds
 *
 * **Authentication ≠ authorization.** Google sign-in (GoTrue) retains no API token; a connection here
 * is a separate, additional consent, and signing in grants this service nothing.
 *
 * **Every data touch is capability-scoped** — against what the connection GRANTED, never against what
 * the vendor can do.
 *
 * **No token ever crosses this boundary.** Connections are read through the view; secrets are reached
 * only through the vault, service-role, for the duration of one adapter call.
 *
 * Connections are per-user, with no owner axis (Decision #59): a team's shared drive is out of scope.
 */

type Actor = ReadActor & { accessToken: string };

const SIGNED_OUT = "Sign in to manage your connections.";
const UNREACHABLE = "We couldn't reach your connections just now. Try again in a moment.";

// #region Projections

interface ProviderRow {
	slug: string;
	label: string;
	category: IntegrationProvider["category"];
	capabilities: IntegrationProvider["capabilities"];
	auth_scheme: IntegrationProvider["authScheme"];
	is_enabled: boolean;
	is_beta: boolean;
	broker: IntegrationProvider["broker"];
	supports_webhooks: boolean;
	default_scopes: string[];
	docs_url: string | null;
	icon_url: string | null;
	sort_order: number;
	created_at: string;
}

const PROVIDER_COLUMNS =
	"slug, label, category, capabilities, auth_scheme, is_enabled, is_beta, broker, supports_webhooks, default_scopes, docs_url, icon_url, sort_order, created_at";

function toProvider(row: ProviderRow): IntegrationProvider {
	return {
		slug: row.slug as IntegrationProvider["slug"],
		label: row.label,
		category: row.category,
		capabilities: row.capabilities ?? [],
		authScheme: row.auth_scheme,
		isEnabled: row.is_enabled,
		isBeta: row.is_beta,
		broker: row.broker,
		supportsWebhooks: row.supports_webhooks,
		defaultScopes: row.default_scopes ?? [],
		docsUrl: row.docs_url,
		iconUrl: row.icon_url,
		sortOrder: row.sort_order,
		createdAt: row.created_at,
	};
}

interface ConnectionRow {
	id: string;
	user_id: string;
	provider_slug: string;
	provider_label: string | null;
	provider_category: UserConnection["providerCategory"];
	provider_capabilities: UserConnection["providerCapabilities"];
	status: UserConnection["status"];
	granted_kinds: UserConnection["grantedKinds"] | null;
	granted_scopes: string[] | null;
	sync_direction: UserConnection["syncDirection"];
	external_account_id: string | null;
	external_account_label: string | null;
	config: Record<string, unknown> | null;
	token_expires_at: string | null;
	last_synced_at: string | null;
	last_error: string | null;
	error_count: number | null;
	connected_at: string | null;
	revoked_at: string | null;
	created_at: string;
	updated_at: string;
}

/** Only flat, non-secret scalars survive into `config` (the schema's own contract). */
function flatConfig(raw: Record<string, unknown> | null): UserConnection["config"] {
	if (!raw) return null;
	const out: Record<string, string | number | boolean> = {};
	for (const [k, v] of Object.entries(raw)) {
		if (typeof v === "string") out[k.slice(0, 80)] = v.slice(0, 600);
		else if (typeof v === "number" || typeof v === "boolean") out[k.slice(0, 80)] = v;
	}
	return Object.keys(out).length > 0 ? out : null;
}

function toConnection(row: ConnectionRow): UserConnection {
	return {
		id: row.id,
		userId: row.user_id,
		providerSlug: row.provider_slug as UserConnection["providerSlug"],
		providerLabel: (row.provider_label ?? row.provider_slug).slice(0, 60),
		providerCategory: row.provider_category,
		providerCapabilities: row.provider_capabilities ?? [],
		status: row.status,
		grantedKinds: row.granted_kinds ?? [],
		grantedScopes: row.granted_scopes ?? [],
		syncDirection: row.sync_direction,
		externalAccountId: row.external_account_id,
		externalAccountLabel: row.external_account_label,
		tokenExpiresAt: row.token_expires_at,
		lastSyncedAt: row.last_synced_at,
		lastError: row.last_error ? row.last_error.slice(0, 500) : null,
		errorCount: row.error_count ?? 0,
		config: flatConfig(row.config),
		connectedAt: row.connected_at,
		revokedAt: row.revoked_at,
		createdAt: row.created_at,
		updatedAt: row.updated_at,
	};
}

// #endregion

// #region Reads

async function readProviders(): Promise<IntegrationProvider[]> {
	const { data, error } = await getAnonClient().schema("integrations").from("providers")
		.select(PROVIDER_COLUMNS).order("sort_order").order("slug");
	if (error) throw new Error(`integrations.providers read failed: ${error.message}`);
	return ((data ?? []) as unknown as ProviderRow[]).map(toProvider);
}

async function readConnections(actor: Actor): Promise<UserConnection[]> {
	const { data, error } = await getUserClient(actor.accessToken).schema("integrations")
		.from("v_my_connections").select("*").order("created_at", { ascending: false });
	if (error) throw new Error(`integrations.v_my_connections read failed: ${error.message}`);
	return ((data ?? []) as unknown as ConnectionRow[]).map(toConnection);
}

/** One of the caller's own connections, or `null` — the view is what scopes it to them. */
async function ownConnection(actor: Actor, id: string): Promise<UserConnection | null> {
	const { data, error } = await getUserClient(actor.accessToken).schema("integrations")
		.from("v_my_connections").select("*").eq("id", id).maybeSingle();
	if (error) {
		if (error.code === "22P02") return null;
		throw new Error(`integrations.v_my_connections read failed: ${error.message}`);
	}
	return data ? toConnection(data as unknown as ConnectionRow) : null;
}

/** The storage checks browsing and mounting share: the caller's connection, granted for files, healthy. */
async function storageConnection(actor: Actor, connectionId: string): Promise<ServiceResult<UserConnection>> {
	const connection = await ownConnection(actor, connectionId);
	// Someone else's connection and a missing one answer alike, so an id cannot be probed.
	if (!connection) return fail(404, { message: "No such connection." }) as ServiceResult<UserConnection>;
	if (!connection.grantedKinds.includes("storage")) {
		return fail(403, { message: `${connection.providerLabel} isn't connected for files.` }) as ServiceResult<
			UserConnection
		>;
	}
	if (!connectionSupports(connection, "storage")) {
		return fail(409, {
			message: connectionIsRecoverable(connection.status)
				? `${connection.providerLabel} needs reconnecting.`
				: `${connection.providerLabel} needs to be connected again.`,
			errors: { connection: connection.status },
		}) as ServiceResult<UserConnection>;
	}
	return ok(connection);
}

// #endregion

async function signedIn<T>(label: string, actor: ReadActor, run: (a: Actor) => Promise<ServiceResult<T>>) {
	if (!canReadLive(actor)) return fail(401, { message: SIGNED_OUT }) as ServiceResult<T>;
	try {
		return await run(actor);
	} catch (error) {
		console.error(`[integrations:${label}]`, error instanceof Error ? error.message : error);
		return fail(503, { message: UNREACHABLE }) as ServiceResult<T>;
	}
}

export class IntegrationsBackendService {
	// #region Catalogue + connections

	/** The public provider catalogue — reference data, sort-ordered. */
	static async providers(): Promise<ServiceResult<IntegrationProvider[]>> {
		try {
			return ok(await readProviders());
		} catch (error) {
			console.error("[integrations:providers]", error instanceof Error ? error.message : error);
			return fail(503, { message: UNREACHABLE }) as ServiceResult<IntegrationProvider[]>;
		}
	}

	/**
	 * The Settings → Integrations payload: the catalogue, the caller's own connections, and the two
	 * capability projections — resolved SEPARATELY, because calendar sync and conferencing are two axes
	 * (a user may sync a Google calendar and host on Zoom).
	 */
	static connections(actor: ReadActor): Promise<ServiceResult<ConnectionsView>> {
		return signedIn("connections", actor, async (a) => {
			const [providers, rows] = await Promise.all([readProviders(), readConnections(a)]);
			const conferencing = rows.find((c) => c.status === "active" && c.grantedKinds.includes("conferencing"));
			return ok({
				providers,
				connections: rows,
				hasCalendar: rows.some((c) => c.status === "active" && c.grantedKinds.includes("calendar")),
				hasConferencing: !!conferencing,
				activeConferencingProvider: conferencing?.providerSlug ?? null,
			});
		});
	}

	// #endregion

	// #region Consent handshake

	/**
	 * Begin an OAuth consent. Refused, in words, for a provider this deployment does not offer: every
	 * catalogue row is disabled until its OAuth client and the vault's envelope key are configured, and
	 * sending someone to an authorize screen that cannot complete would waste their consent.
	 */
	static startConnection(
		input: StartConnection,
		actor: ReadActor,
	): Promise<ServiceResult<{ state: string; authorizeUrl: string; expiresAt: string }>> {
		return signedIn("start", actor, async () => {
			const provider = (await readProviders()).find((p) => p.slug === input.providerSlug);
			if (!provider) return fail(404, { message: "No such provider." }) as ServiceResult<never>;
			if (provider.authScheme === "aws_sigv4") {
				return fail(422, {
					message: `${provider.label} connects with an access key, not a consent screen.`,
					errors: { providerSlug: "Use the credential form for this provider." },
				}) as ServiceResult<never>;
			}
			if (!provider.isEnabled) {
				return fail(409, { message: `${provider.label} isn't available to connect yet.` }) as ServiceResult<never>;
			}
			return fail(503, {
				message: `Connecting ${provider.label} isn't set up in this environment yet.`,
			}) as ServiceResult<never>;
		});
	}

	/**
	 * Complete a consent. No consent can be in flight in this deployment ({@link startConnection}
	 * issues none), so a callback is always one we never started — refused, never activated.
	 */
	static completeConnection(_input: { state: string; code: string }): Promise<ServiceResult<UserConnection>> {
		return Promise.resolve(
			fail(400, { message: "That connection request wasn't recognised. Start it again from Settings." }) as ServiceResult<
				UserConnection
			>,
		);
	}

	/**
	 * Revoke a stored authorization — terminal. The secret row goes first, so a failure part-way still
	 * leaves the platform holding no token; the view proves the connection is the caller's before the
	 * service role touches anything.
	 */
	static revokeConnection(input: RevokeConnection, actor: ReadActor): Promise<ServiceResult<{ revoked: boolean }>> {
		return signedIn("revoke", actor, async (a) => {
			const connection = await ownConnection(a, input.connectionId);
			if (!connection) return fail(404, { message: "No such connection." }) as ServiceResult<{ revoked: boolean }>;
			if (connection.status === "revoked") return ok({ revoked: false }, { message: "That connection is already closed." });
			const service = getServiceClient().schema("integrations");
			const secrets = await service.from("connection_secrets").delete().eq("connection_id", connection.id);
			if (secrets.error) throw new Error(`integrations.connection_secrets delete failed: ${secrets.error.message}`);
			const now = new Date().toISOString();
			const revoked = await service.from("user_connections")
				.update({ status: "revoked", revoked_at: now, updated_at: now })
				.eq("id", connection.id).eq("user_id", a.userId);
			if (revoked.error) throw new Error(`integrations.user_connections update failed: ${revoked.error.message}`);
			// The owner's lifecycle trail. Written after the revocation, and never allowed to undo it: the
			// credential is already gone, and reporting a failure now would send the person to retry a
			// revocation that succeeded.
			const audit = await service.from("connection_audit").insert({
				connection_id: connection.id,
				user_id: a.userId,
				provider_slug: connection.providerSlug,
				action: "revoked",
				detail: "Revoked by the account owner.",
			});
			if (audit.error) console.error("[integrations:revoke] audit line not written:", audit.error.message);
			return ok({ revoked: true }, { message: "Connection revoked." });
		});
	}

	// #endregion

	// #region Browsing + mounting

	/**
	 * Browse one level of a connected drive. The caller's own storage-granted connection is checked
	 * first; the provider call itself would carry a stored credential out of the process, and no
	 * adapter can hold one in this deployment, so it answers that plainly.
	 */
	static browse(params: DriveBrowseParams, actor: ReadActor): Promise<ServiceResult<DriveBrowsePage>> {
		return signedIn("browse", actor, async (a) => {
			const checked = await storageConnection(a, params.connectionId);
			if (!checked.ok) return checked as unknown as ServiceResult<DriveBrowsePage>;
			return fail(503, {
				message: `Browsing ${checked.data!.providerLabel} isn't available in this environment yet.`,
			}) as ServiceResult<DriveBrowsePage>;
		});
	}

	/**
	 * Mount a connected object into the acting library — a REFERENCE, never a copy. Two authorities must
	 * agree: the connection must be the caller's and granted for files, and the destination library must
	 * be the one the session acts for.
	 */
	static importAsset(input: {
		connectionId: string;
		externalFileId: string;
		folderId: string | null;
		ownerType: "user" | "team" | "business" | "organisation";
		ownerId: string;
	}, actor: ReadActor): Promise<ServiceResult<AssetItem>> {
		return signedIn("import", actor, async (a) => {
			if (!mayFileInto(a, { ownerType: input.ownerType, ownerId: input.ownerId })) {
				return fail(403, { message: "You can't add files to that library." }) as ServiceResult<AssetItem>;
			}
			const checked = await storageConnection(a, input.connectionId);
			if (!checked.ok) return checked as unknown as ServiceResult<AssetItem>;
			return fail(503, {
				message: `Adding files from ${checked.data!.providerLabel} isn't available in this environment yet.`,
			}) as ServiceResult<AssetItem>;
		});
	}

	// #endregion
}
