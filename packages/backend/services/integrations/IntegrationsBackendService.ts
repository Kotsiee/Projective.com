import type { AssetItem } from "@projective/types/files";
import type {
	ConnectionSecretRow,
	ConnectionsView,
	DriveBrowsePage,
	DriveBrowseParams,
	IntegrationProvider,
	ProviderKind,
	RevokeConnection,
	SetSyncDirection,
	StartConnection,
	UserConnection,
} from "@projective/types/integrations";
import { connectionIsRecoverable, connectionSupports } from "@projective/types/integrations";
import type { PresenceOutcome } from "@projective/types/projects";
import { fail, ok, type ServiceResult } from "../ServiceResult.ts";
import { isBearerAuthorised } from "../../core/bearer.ts";
import { serverEnv } from "../../core/env.ts";
import {
	getAnonClient,
	getServiceClient,
	getUserClient,
	isIntegrationsBackendLive,
} from "../../core/supabase.ts";
import { canReadLive, type ReadActor } from "../read-actor.ts";
import { mayFileInto } from "../files/live-library.ts";
import { PRESENCE_ADAPTERS, type PresenceAdapter } from "../sessions/presence/mod.ts";
import { SessionBackendService } from "../sessions/SessionBackendService.ts";
import { CALENDAR_ADAPTERS } from "./calendar-adapters.ts";
import { type ChannelRow, renewChannel, type RenewedChannel, stopChannel } from "./channels.ts";
import {
	authorizeUrl,
	exchangeCode,
	expiryIn,
	grantedKindsOf,
	OAuthError,
	oauthFlow,
	randomToken,
	readIdentity,
	refreshGrant,
	revokeGrant,
	scopesFor,
	sharesGoogleGrant,
	type TokenSet,
} from "./oauth.ts";
import { seal, unseal } from "./token-vault.ts";
import {
	createStorageAdapter,
	type StorageAdapter,
	StorageAdapterError,
	type StorageAdapterErrorCode,
} from "./adapters/mod.ts";

/**
 * IntegrationsBackendService — the FAT half of the connector subsystem: the provider catalogue, a
 * user's stored authorizations, the consent handshake, token refresh and channel renewal, the one
 * provider webhook, browsing a connected drive, and mounting one of its objects into the `/files` hub.
 *
 * The catalogue and the caller's connections are read LIVE — the providers table (public reference
 * data) and `integrations.v_my_connections`, the definer view that physically cannot project a token
 * column, so no credential can reach a response even by mistake.
 *
 * Connecting needs `INTEGRATIONS_BACKEND_LIVE`, an enabled provider with a seeded `auth_config`, and
 * its OAuth client in the environment; without one, {@link startConnection} refuses in words. The
 * runtime is Fresh routes plus pg_cron http jobs, never Edge Functions (Decision #343, ruling C4 (a)),
 * and each transaction is a service-role definer in `00001500`. What a connected calendar syncs is
 * `CalendarSyncBackendService`; this service only marks one due and closes it. Browsing carries the
 * connection's stored credential to its provider for one call, through `./adapters`; mounting an
 * object still answers that it is not available here. A refusal in words is the honest state; a
 * simulated drive is not.
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
const CONSENT_REFUSED = "That connection request wasn't recognised. Start it again from Settings.";
const NOT_LIVE = "Connections aren't live in this environment.";
const FORGED = "The delivery's signature didn't verify.";
/** The page a browse asks a provider for when the caller names none. */
const BROWSE_PAGE = 100;

/** One leading `/`, and no backslash or whitespace a browser would normalise into another origin. */
const RETURN_PATH = /^\/(?!\/)[^\\\s]*$/;

/** How many rows a sweep works at once. A full batch has to fit pg_net's 120 s and the claim's lease. */
const SWEEP_CONCURRENCY = 10;

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
	auth_config?: unknown;
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

/**
 * Whether a person can connect this provider here. An OAuth provider needs this environment's client:
 * credentials are what turn one on, and a row without them is absent, never a Connect that fails.
 */
function connectable(row: ProviderRow): boolean {
	if (!row.is_enabled) return false;
	return row.auth_scheme !== "oauth2" ||
		(isIntegrationsBackendLive() && oauthFlow(row.slug, row.auth_config) !== null);
}

async function readProviders(): Promise<IntegrationProvider[]> {
	const { data, error } = await getAnonClient().schema("integrations").from("providers")
		.select(`${PROVIDER_COLUMNS}, auth_config`).order("sort_order").order("slug");
	if (error) throw new Error(`integrations.providers read failed: ${error.message}`);
	return ((data ?? []) as unknown as ProviderRow[]).map((row) => ({
		...toProvider(row),
		isEnabled: connectable(row),
	}));
}

/** One catalogue row with its `auth_config`, which is non-secret by the column's own contract. */
async function readProviderRow(slug: string): Promise<ProviderRow | null> {
	const { data, error } = await getAnonClient().schema("integrations").from("providers")
		.select(`${PROVIDER_COLUMNS}, auth_config`).eq("slug", slug).maybeSingle();
	if (error) throw new Error(`integrations.providers read failed: ${error.message}`);
	return data as unknown as ProviderRow | null;
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

/** How a provider call's failure is worded, by the adapter's refusal code. */
const STORAGE_REFUSALS: Readonly<
	Record<StorageAdapterErrorCode, { status: number; words: (label: string) => string }>
> = {
	unauthorized: { status: 409, words: (label) => `${label} needs reconnecting.` },
	forbidden: { status: 403, words: (label) => `${label} won't let this account open that.` },
	not_found: { status: 404, words: (label) => `That isn't in ${label} any more.` },
	rate_limited: { status: 429, words: (label) => `${label} is busy. Try again in a moment.` },
	misconfigured: {
		status: 502,
		words: (label) => `${label} couldn't be read. Try reconnecting it.`,
	},
	unavailable: {
		status: 503,
		words: (label) => `Browsing ${label} isn't available in this environment yet.`,
	},
	provider_error: {
		status: 502,
		words: (label) => `${label} couldn't be reached. Try again in a moment.`,
	},
};

/**
 * Run one provider call under the caller's own storage connection. The credential is claimed here,
 * lives for this call and leaves through nothing but the adapter's request; a provider's refusal comes
 * back in words, and anything else is the caller's 503.
 *
 * shortcut: bearer connections only, because no S3 connection can exist until a credential form does;
 * read its key pair from the vault here then.
 */
async function withStorage<T>(
	actor: Actor,
	connectionId: string,
	run: (adapter: StorageAdapter, connection: UserConnection) => Promise<T>,
): Promise<ServiceResult<T>> {
	const checked = await storageConnection(actor, connectionId);
	if (!checked.ok) return checked as unknown as ServiceResult<T>;
	const connection = checked.data!;
	const refusal = (code: StorageAdapterErrorCode) => {
		const { status, words } = STORAGE_REFUSALS[code];
		return fail(status, { message: words(connection.providerLabel) }) as ServiceResult<T>;
	};
	if (!isIntegrationsBackendLive()) return refusal("unavailable");
	const accessToken = await IntegrationsBackendService.accessToken(connection.id);
	if (!accessToken) return refusal("unauthorized");
	try {
		const credential = { scheme: "bearer", accessToken } as const;
		return ok(await run(createStorageAdapter({ connection, credential }), connection));
	} catch (error) {
		if (error instanceof StorageAdapterError) {
			console.error("[integrations:storage]", error.message);
			return refusal(error.code);
		}
		throw error;
	}
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

// #region Consent

const integrationsDb = () => getServiceClient().schema("integrations");

interface ConsentRow {
	user_id: string;
	provider_slug: string;
	code_verifier: string | null;
	requested_kinds: ProviderKind[];
	return_to: string | null;
}

/** Spend a `state`. One UPDATE, so of two callbacks racing on it exactly one finds the row. */
async function consumeConsent(state: string): Promise<ConsentRow | null> {
	const now = new Date().toISOString();
	const { data, error } = await integrationsDb().from("consent_states")
		.update({ consumed_at: now })
		.eq("state", state).is("consumed_at", null).gt("expires_at", now)
		.select("user_id, provider_slug, code_verifier, requested_kinds, return_to").maybeSingle();
	if (error) throw new Error(`integrations.consent_states update failed: ${error.message}`);
	return data as ConsentRow | null;
}

/**
 * Seal a grant and store it in one transaction, answering the connection's id. Each ciphertext's AAD
 * names the connection, so the id must be known before the seal: a new row's is minted here, and
 * `fn_store_connection` writes nothing and answers the existing row's id when the account is already
 * linked (or a concurrent consent just linked it), for a second pass under that id.
 */
async function storeGrant(
	consent: ConsentRow,
	tokens: TokenSet,
	identity: { id: string; label: string | null },
	granted: { kinds: ProviderKind[]; scopes: string[] },
): Promise<string> {
	let connectionId: string = crypto.randomUUID();
	for (let pass = 0; pass < 2; pass++) {
		const { data, error } = await integrationsDb().rpc("fn_store_connection", {
			p_connection_id: connectionId,
			p_user_id: consent.user_id,
			p_provider_slug: consent.provider_slug,
			p_external_account_id: identity.id,
			p_external_account_label: identity.label,
			p_granted_kinds: granted.kinds,
			p_granted_scopes: granted.scopes,
			p_access_expires_at: expiryIn(tokens.expires_in),
			p_refresh_expires_at: expiryIn(tokens.refresh_token_expires_in),
			p_secret: await seal(connectionId, {
				access_token: tokens.access_token,
				refresh_token: tokens.refresh_token,
			}),
		});
		if (error) throw new Error(`integrations.fn_store_connection failed: ${error.message}`);
		if (data === connectionId) return connectionId;
		connectionId = data as string;
	}
	throw new Error("integrations.fn_store_connection did not settle on a connection.");
}

/**
 * What revoking a connection at its provider needs, or `null` when that cannot run: no client here, no
 * row, or a row that will not open. None of those may stop a disconnect.
 */
async function heldGrant(connection: UserConnection) {
	try {
		const [provider, secrets] = await Promise.all([
			readProviderRow(connection.providerSlug),
			integrationsDb().from("connection_secrets").select("*")
				.eq("connection_id", connection.id).maybeSingle(),
		]);
		const flow = provider && oauthFlow(provider.slug, provider.auth_config);
		if (!flow || !secrets.data) return null;
		const secret = secrets.data as ConnectionSecretRow;
		return {
			flow,
			tokens: [
				await unseal(connection.id, secret, "refresh_token"),
				await unseal(connection.id, secret, "access_token"),
			],
		};
	} catch (error) {
		console.error("[integrations:revoke] grant not read:", error instanceof Error ? error.message : error);
		return null;
	}
}

/**
 * What a calendar connection left running at its provider and a token to close it with, read before
 * the door deletes the token. `null` when there is nothing to close or no way to. Neither may stop a
 * disconnect.
 */
async function heldCalendar(connection: UserConnection) {
	const adapter = CALENDAR_ADAPTERS[connection.providerSlug];
	if (!adapter) return null;
	try {
		const { data, error } = await integrationsDb().from("webhook_subscriptions")
			.select("provider_slug, external_channel_id, external_resource_id")
			.eq("connection_id", connection.id).in("status", ["active", "expiring"]);
		if (error) throw new Error(`integrations.webhook_subscriptions read failed: ${error.message}`);
		const channels = (data ?? []) as Pick<
			ChannelRow,
			"provider_slug" | "external_channel_id" | "external_resource_id"
		>[];
		const calendarId = connection.config?.outbound_calendar_id;
		if (channels.length === 0 && typeof calendarId !== "string") return null;
		const accessToken = await IntegrationsBackendService.accessToken(connection.id);
		return accessToken ? { adapter, accessToken, channels, calendarId } : null;
	} catch (error) {
		console.error("[integrations:revoke] calendar not read:", error instanceof Error ? error.message : error);
		return null;
	}
}

// #endregion

// #region Sweeps

/** What each sweep answers its cron route. */
export interface ConnectionSweep {
	claimed: number;
	done: number;
	/** `invalid_grant`: the connection moved to `expired` and its owner was told. */
	expired: number;
	failed: number;
}

/** What `fn_claim_connections_for_refresh` answers per row. */
interface RefreshClaim {
	provider_slug: string;
	auth_config: unknown;
	secret: ConnectionSecretRow;
}

/** What `fn_claim_channels_for_renewal` answers per row. */
interface ChannelClaim {
	channel: ChannelRow;
	secret: ConnectionSecretRow;
}

/** Run a sweep's rows a chunk at a time. */
export async function inChunks<T, R>(rows: T[], run: (row: T) => Promise<R>): Promise<R[]> {
	const results: R[] = [];
	for (let i = 0; i < rows.length; i += SWEEP_CONCURRENCY) {
		results.push(...await Promise.all(rows.slice(i, i + SWEEP_CONCURRENCY).map(run)));
	}
	return results;
}

/** A sweep's outcomes as its cron route answers them. */
export function tally(outcomes: ("done" | "expired" | "failed")[]): ConnectionSweep {
	const count = (outcome: string) => outcomes.filter((o) => o === outcome).length;
	return {
		claimed: outcomes.length,
		done: count("done"),
		expired: count("expired"),
		failed: count("failed"),
	};
}

/**
 * Refresh one claimed connection. The exchange is a network call, so it cannot sit inside the claim's
 * transaction: the claim's lease keeps a second run off the row, and `fn_commit_refresh` writes only
 * if the row still holds the refresh token this run read. A rotated token therefore lands atomically
 * or not at all, and no run can spend a token another run is holding.
 */
async function refreshOne(claim: RefreshClaim): Promise<"done" | "expired" | "failed"> {
	const { secret, provider_slug: slug } = claim;
	const id = secret.connection_id;
	try {
		const flow = oauthFlow(slug, claim.auth_config);
		if (!flow) throw new Error(`${slug} has no OAuth client here.`);
		const refreshToken = await unseal(id, secret, "refresh_token");
		if (!refreshToken) throw new Error(`Connection ${id} holds no refresh token.`);
		const tokens = await refreshGrant(flow, refreshToken);
		const { error } = await integrationsDb().rpc("fn_commit_refresh", {
			p_connection_id: id,
			p_read_cipher: secret.refresh_token_cipher,
			// Google answers no refresh token: the one it did not replace is still the grant.
			p_secret: await seal(id, {
				access_token: tokens.access_token,
				refresh_token: tokens.refresh_token ?? refreshToken,
			}),
			p_access_expires_at: expiryIn(tokens.expires_in),
			p_refresh_expires_at: expiryIn(tokens.refresh_token_expires_in) ??
				secret.refresh_token_expires_at,
		});
		if (error) throw new Error(`integrations.fn_commit_refresh failed: ${error.message}`);
		return "done";
	} catch (error) {
		const invalidGrant = error instanceof OAuthError && error.code === "invalid_grant";
		if (!(error instanceof OAuthError)) {
			console.error("[integrations:refresh]", id, error instanceof Error ? error.message : error);
		}
		const { error: unrecorded } = await integrationsDb().rpc("fn_record_refresh_failure", {
			p_connection_id: id,
			p_read_cipher: secret.refresh_token_cipher,
			p_invalid_grant: invalidGrant,
			// `last_error` reaches the owner's settings screen, so only a provider's status and code do.
			p_detail: error instanceof OAuthError ? error.message : "The token refresh failed.",
		});
		if (unrecorded) console.error("[integrations:refresh] failure not recorded:", unrecorded.message);
		return invalidGrant ? "expired" : "failed";
	}
}

async function renewOne({ channel, secret }: ChannelClaim): Promise<"done" | "failed"> {
	let renewed: RenewedChannel | null = null;
	try {
		const accessToken = await unseal(channel.connection_id, secret, "access_token");
		if (!accessToken) throw new Error("The connection holds no access token.");
		renewed = await renewChannel(channel, accessToken);
	} catch (error) {
		console.error("[integrations:channels]", channel.id, error instanceof Error ? error.message : error);
	}
	const { error } = await integrationsDb().rpc("fn_record_channel_renewal", {
		p_subscription_id: channel.id,
		p_renewed: renewed !== null,
		p_expires_at: renewed?.expiresAt ?? null,
		p_external_channel_id: renewed?.externalChannelId ?? null,
		p_external_resource_id: renewed?.externalResourceId ?? null,
	});
	if (error) console.error("[integrations:channels] outcome not recorded:", error.message);
	return renewed ? "done" : "failed";
}

// #endregion

// #region Webhooks

/** What a verified delivery answers. `handshake` goes back as `text/plain`, `challenge` as JSON. */
export interface WebhookReceipt {
	received: true;
	handshake?: string;
	challenge?: Record<string, string>;
	outcomes: PresenceOutcome[];
}

/** The secret a channel's pushes must present, or `null` for a channel with no live row. */
async function channelToken(provider: string, channel: string): Promise<string | null> {
	const { data, error } = await integrationsDb().from("webhook_subscriptions")
		.select("verification_token").eq("provider_slug", provider).eq("external_channel_id", channel)
		.in("status", ["active", "expiring"]).limit(1).maybeSingle();
	if (error) throw new Error(`integrations.webhook_subscriptions read failed: ${error.message}`);
	return (data as { verification_token: string | null } | null)?.verification_token ?? null;
}

/**
 * A calendar push (providers spec §3.3). Each channel has its own secret and Graph batches several
 * into one delivery, so it is judged part by part, and a delivery with no part that verifies is
 * refused. A push says only "look again", so it marks the calendar due and the job does the reading.
 */
async function calendarPush(
	provider: string,
	adapter: PresenceAdapter,
	raw: string,
	headers: Headers,
	nowMs: number,
): Promise<ServiceResult<WebhookReceipt>> {
	let verified = false;
	for (const part of adapter.split?.(raw) ?? [raw]) {
		const channel = adapter.channelOf?.(part, headers);
		const secret = channel && await channelToken(provider, channel);
		if (!secret || !(await adapter.verify(part, headers, secret, nowMs))) continue;
		verified = true;
		const { error } = await integrationsDb().rpc("fn_mark_calendar_due", {
			p_provider_slug: provider,
			p_channel: channel,
			p_renew: adapter.lapsed?.(part) ?? false,
		});
		if (error) throw new Error(`integrations.fn_mark_calendar_due failed: ${error.message}`);
	}
	return verified ? ok({ received: true, outcomes: [] }) : fail(400, { message: FORGED });
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

/** One hub location inside a connected drive. */
export interface DriveLocation {
	page: DriveBrowsePage;
	/** The connection, for the location's root crumb. */
	connection: Pick<UserConnection, "providerSlug" | "providerLabel">;
	/** The folders from the drive's root to this location, root-first. */
	trail: { id: string; name: string }[];
}

/** One level of a drive, in the browse contract's shape. */
async function listLevel(
	adapter: StorageAdapter,
	params: DriveBrowseParams,
): Promise<DriveBrowsePage> {
	const location = { folderId: params.folderId ?? null, path: params.path ?? null };
	const { entries, folders, hasMore, nextCursor } = await adapter.list(
		location,
		params.cursor ?? null,
		params.limit ?? BROWSE_PAGE,
	);
	return { entries, folders, hasMore, nextCursor };
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
	 * Begin an OAuth consent (providers spec §7.1). Refused, in words, for a provider this deployment
	 * does not offer: sending someone to an authorize screen that cannot complete would waste their
	 * consent.
	 *
	 * The `consent_states` row is written by `fn_open_consent` under the caller's JWT, because
	 * `actor.userId` is an unverified decode: a service-role write could bind a consent to any user a
	 * forged cookie named, and `auth.uid()` cannot be forged past PostgREST.
	 */
	static startConnection(
		input: StartConnection,
		actor: ReadActor,
	): Promise<ServiceResult<{ state: string; authorizeUrl: string; expiresAt: string }>> {
		return signedIn("start", actor, async (a) => {
			const row = await readProviderRow(input.providerSlug);
			if (!row) return fail(404, { message: "No such provider." }) as ServiceResult<never>;
			const provider = toProvider(row);
			if (provider.authScheme === "aws_sigv4") {
				return fail(422, {
					message: `${provider.label} connects with an access key, not a consent screen.`,
					errors: { providerSlug: "Use the credential form for this provider." },
				}) as ServiceResult<never>;
			}
			if (!provider.isEnabled) {
				return fail(409, { message: `${provider.label} isn't available to connect yet.` }) as ServiceResult<never>;
			}
			const flow = isIntegrationsBackendLive() ? oauthFlow(provider.slug, row.auth_config) : null;
			if (!flow) {
				return fail(503, {
					message: `Connecting ${provider.label} isn't set up in this environment yet.`,
				}) as ServiceResult<never>;
			}
			const kinds = input.kinds?.length ? input.kinds : provider.capabilities;
			if (!kinds.every((kind) => provider.capabilities.includes(kind))) {
				return fail(422, {
					message: `${provider.label} can't be connected for that.`,
					errors: { kinds: "Ask only for what this provider offers." },
				}) as ServiceResult<never>;
			}
			if (input.returnTo !== undefined && !RETURN_PATH.test(input.returnTo)) {
				return fail(422, {
					message: "That connection could not be started.",
					errors: { returnTo: "Use a path on this site." },
				}) as ServiceResult<never>;
			}
			const state = randomToken();
			const verifier = flow.config.pkce ? randomToken() : null;
			const { data, error } = await getUserClient(a.accessToken).schema("integrations").rpc(
				"fn_open_consent",
				{
					p_state: state,
					p_provider_slug: provider.slug,
					p_code_verifier: verifier,
					p_requested_kinds: kinds,
					p_return_to: input.returnTo ?? null,
				},
			);
			if (error) throw new Error(`integrations.fn_open_consent failed: ${error.message}`);
			return ok({
				state,
				authorizeUrl: await authorizeUrl(flow, {
					state,
					verifier,
					scopes: scopesFor(flow.config, provider.defaultScopes, kinds),
				}),
				expiresAt: data as string,
			});
		});
	}

	/**
	 * Complete a consent (providers spec §7.1, step 3). The `state` is spent first, the code is
	 * exchanged before anything is written, and one transaction stores the connection, its sealed
	 * tokens and the audit line. A grant the provider issued that we then fail to keep is revoked there
	 * (best effort), so no orphan outlives us.
	 *
	 * `code` is `null` when the provider reported a declined consent: its `state` is still spent.
	 * `state` alone cannot tell whose browser came back, because a consent link can be sent to someone
	 * else, who would then attach their account to the sender's; so the browser finishing the consent
	 * must be signed in as the person who started it. A refusal carries `returnTo` in its details.
	 */
	static async completeConnection(
		input: { state: string; code: string | null },
		actor: ReadActor,
	): Promise<ServiceResult<{ connectionId: string; returnTo: string | null }>> {
		type Completed = ServiceResult<{ connectionId: string; returnTo: string | null }>;
		const refused = (returnTo: string | null) =>
			fail(400, { message: CONSENT_REFUSED, details: { returnTo } }) as Completed;
		if (!isIntegrationsBackendLive()) return refused(null);
		let returnTo: string | null = null;
		try {
			const consent = await consumeConsent(input.state);
			if (!consent || consent.user_id !== actor.userId) return refused(null);
			returnTo = consent.return_to;
			if (!input.code) return refused(returnTo);
			const provider = await readProviderRow(consent.provider_slug);
			const flow = provider?.is_enabled ? oauthFlow(provider.slug, provider.auth_config) : null;
			if (!flow) return refused(returnTo);

			const tokens = await exchangeCode(flow, input.code, consent.code_verifier);
			try {
				const scopes = tokens.scope?.split(" ").filter(Boolean) ??
					scopesFor(flow.config, provider!.default_scopes, consent.requested_kinds);
				const kinds = grantedKindsOf(flow.config, consent.requested_kinds, scopes);
				if (kinds.length === 0) throw new OAuthError(flow.slug, 200, "no_capability_granted");
				const identity = await readIdentity(flow, tokens.access_token);
				const connectionId = await storeGrant(consent, tokens, identity, { kinds, scopes });
				return ok({ connectionId, returnTo });
			} catch (error) {
				await revokeGrant(flow, [tokens.refresh_token ?? null, tokens.access_token]);
				throw error;
			}
		} catch (error) {
			// `cause` is where a network failure says why: "fetch failed" alone names nothing.
			const why = error instanceof Error ? [error.message, (error.cause as Error)?.message] : [error];
			console.error("[integrations:complete]", ...why.filter(Boolean));
			return refused(returnTo);
		}
	}

	/**
	 * Revoke a stored authorization — terminal until a fresh consent. `fn_revoke_connection` drops the
	 * secret row, closes the connection, expires its channels and archives its busy rows in one
	 * transaction; the view proves the connection is the caller's before the service role touches
	 * anything.
	 *
	 * The provider is told last, from tokens read beforehand: its push channels stop, the Projective
	 * calendar we made there goes, and the grant is revoked. It is best effort and never undoes the
	 * revocation: by then we hold no credential, and reporting a failure would send the person to retry
	 * something that succeeded.
	 */
	static revokeConnection(input: RevokeConnection, actor: ReadActor): Promise<ServiceResult<{ revoked: boolean }>> {
		return signedIn("revoke", actor, async (a) => {
			const connection = await ownConnection(a, input.connectionId);
			if (!connection) return fail(404, { message: "No such connection." }) as ServiceResult<{ revoked: boolean }>;
			if (connection.status === "revoked") return ok({ revoked: false }, { message: "That connection is already closed." });
			// In this order: a token refreshed on the way out rotates what heldGrant then reads.
			const calendar = await heldCalendar(connection);
			const grant = await heldGrant(connection);
			const { error } = await integrationsDb().rpc("fn_revoke_connection", {
				p_connection_id: connection.id,
				p_detail: "Revoked by the account owner.",
			});
			if (error) throw new Error(`integrations.fn_revoke_connection failed: ${error.message}`);
			if (calendar) {
				await Promise.all(calendar.channels.map((c) => stopChannel(c, calendar.accessToken)));
				if (typeof calendar.calendarId === "string") {
					await calendar.adapter.removeCalendar(calendar.accessToken, calendar.calendarId)
						.catch((failed) => console.error("[integrations:revoke] calendar left:", failed.message));
				}
			}
			const shared = grant &&
				(await readConnections(a)).some((other) =>
					other.status !== "revoked" && other.status !== "disconnected" &&
					sharesGoogleGrant(other.providerSlug, connection.providerSlug)
				);
			if (grant && !shared) await revokeGrant(grant.flow, grant.tokens);
			return ok({ revoked: true }, { message: "Connection revoked." });
		});
	}

	/**
	 * Turn a connection's separate Projective calendar on or off. `inbound` is busy time only, and
	 * `bidirectional` adds the calendar (Decision #383, ruling R3). The view proves the connection is
	 * the caller's; the job then writes or removes the copies.
	 */
	static setSyncDirection(
		input: SetSyncDirection,
		actor: ReadActor,
	): Promise<ServiceResult<{ changed: boolean }>> {
		return signedIn("sync-direction", actor, async (a) => {
			const connection = await ownConnection(a, input.connectionId);
			if (!connection) return fail(404, { message: "No such connection." }) as ServiceResult<{ changed: boolean }>;
			if (input.syncDirection !== "inbound" && !connectionSupports(connection, "calendar")) {
				return fail(409, {
					message: `${connection.providerLabel} needs connecting again before it can hold a Projective calendar.`,
					errors: { connection: connection.status },
				}) as ServiceResult<{ changed: boolean }>;
			}
			const { data, error } = await integrationsDb().rpc("fn_set_sync_direction", {
				p_connection_id: connection.id,
				p_direction: input.syncDirection,
			});
			if (error) throw new Error(`integrations.fn_set_sync_direction failed: ${error.message}`);
			return ok({ changed: data as boolean });
		});
	}

	// #endregion

	// #region Scheduled work

	/** Whether a request carries the scheduler's bearer token (`INTEGRATIONS_CRON_SECRET`). */
	static isCronAuthorised(authorization: string | null): boolean {
		return isBearerAuthorised(authorization, serverEnv().integrationsCronSecret);
	}

	/**
	 * Refresh every connection due (job `integrations-refresh-tokens`, providers spec §7.6). A failure
	 * on one row is recorded on it and never stops the rest.
	 */
	static async refreshDue(limit = 100): Promise<ServiceResult<ConnectionSweep>> {
		if (!isIntegrationsBackendLive()) return fail(503, { message: NOT_LIVE });
		try {
			const { data, error } = await integrationsDb().rpc("fn_claim_connections_for_refresh", {
				p_limit: limit,
			});
			if (error) throw new Error(`integrations.fn_claim_connections_for_refresh failed: ${error.message}`);
			return ok(tally(await inChunks(data as RefreshClaim[], refreshOne)));
		} catch (error) {
			console.error("[integrations:refresh]", error instanceof Error ? error.message : error);
			return fail(503, { message: UNREACHABLE });
		}
	}

	/**
	 * A token to call a provider with now, for work that cannot wait for the refresh job: minting a
	 * room, reading a meeting's record. `null` when this connection cannot give one, including while
	 * another run is refreshing it, so the caller tries again later. The token must not leave the
	 * service layer.
	 */
	static async accessToken(connectionId: string): Promise<string | null> {
		const { data, error } = await integrationsDb().rpc("fn_claim_connection_token", {
			p_connection_id: connectionId,
		});
		if (error) throw new Error(`integrations.fn_claim_connection_token failed: ${error.message}`);
		const claim = data as (RefreshClaim & { refresh?: boolean; busy?: boolean }) | null;
		if (!claim || claim.busy) return null;
		if (!claim.refresh) return unseal(connectionId, claim.secret, "access_token");
		if (await refreshOne(claim) !== "done") return null;
		const { data: fresh, error: unread } = await integrationsDb().from("connection_secrets").select("*")
			.eq("connection_id", connectionId).single();
		if (unread) throw new Error(`integrations.connection_secrets read failed: ${unread.message}`);
		return unseal(connectionId, fresh as ConnectionSecretRow, "access_token");
	}

	/** Renew every push channel due (job `integrations-renew-channels`, providers spec §7.6). */
	static async renewChannels(limit = 100): Promise<ServiceResult<ConnectionSweep>> {
		if (!isIntegrationsBackendLive()) return fail(503, { message: NOT_LIVE });
		try {
			const { data, error } = await integrationsDb().rpc("fn_claim_channels_for_renewal", {
				p_limit: limit,
			});
			if (error) throw new Error(`integrations.fn_claim_channels_for_renewal failed: ${error.message}`);
			return ok(tally(await inChunks(data as ChannelClaim[], renewOne)));
		} catch (error) {
			console.error("[integrations:channels]", error instanceof Error ? error.message : error);
			return fail(503, { message: UNREACHABLE });
		}
	}

	// #endregion

	// #region Webhooks

	/**
	 * The one provider webhook (Decision #343, ruling C4 (a)). The raw body and headers go to the
	 * provider's adapter untouched, and nothing acts until the delivery is proved the provider's own:
	 * by its signature, or for a provider that signs nothing by its channel's stored token (providers
	 * spec §3.3). Then a handshake is answered, a removed app revokes its connection, a calendar push
	 * marks its calendar due, and presence goes to {@link SessionBackendService.handlePresenceWebhook}.
	 *
	 * Each presence or removal effect claims its `webhook_deliveries` row in its own SQL call, so a replay
	 * is a 2xx no-op, and a replayed push only marks the same calendar due again.
	 * The status is the provider's contract: 2xx acknowledges (an ignored event too), 400 refuses a
	 * forged or stale delivery, 404 an unknown provider, 503 asks for a redelivery.
	 */
	static async handleWebhook(
		provider: string,
		raw: string,
		headers: Headers,
		url: URL,
		nowMs = Date.now(),
	): Promise<ServiceResult<WebhookReceipt>> {
		if (!Object.hasOwn(PRESENCE_ADAPTERS, provider)) {
			return fail(404, { message: "Unknown provider." });
		}
		const adapter = PRESENCE_ADAPTERS[provider];
		const handshake = adapter.handshake?.(url);
		if (handshake) return ok({ received: true, handshake, outcomes: [] });
		try {
			if (adapter.channelOf) return await calendarPush(provider, adapter, raw, headers, nowMs);
			const secret = adapter.secret();
			if (!secret) return fail(503, { message: "Webhooks for this provider aren't configured." });
			if (!(await adapter.verify(raw, headers, secret, nowMs))) return fail(400, { message: FORGED });

			let body: unknown;
			try {
				body = JSON.parse(raw);
			} catch {
				return fail(400, { message: "The delivery isn't JSON." });
			}
			const challenge = await adapter.challenge(body, secret);
			if (challenge) return ok({ received: true, challenge, outcomes: [] });

			const deauthorized = adapter.deauthorization?.(body);
			if (deauthorized) {
				const { error } = await integrationsDb().rpc("fn_deauthorize_connection", {
					p_provider_slug: provider,
					p_external_account_id: deauthorized.externalAccountId,
					p_delivery_id: deauthorized.deliveryId,
				});
				if (error) throw new Error(`integrations.fn_deauthorize_connection failed: ${error.message}`);
				return ok({ received: true, outcomes: [] });
			}

			const events = adapter.parse(body);
			if (events.length === 0) return ok({ received: true, outcomes: [] });
			const recorded = await SessionBackendService.handlePresenceWebhook(events);
			if (!recorded.ok) return fail(recorded.status, { message: recorded.message });
			return ok({ received: true, outcomes: recorded.data!.outcomes });
		} catch (error) {
			console.error("[integrations:webhook]", provider, error instanceof Error ? error.message : error);
			return fail(503, { message: "The delivery couldn't be handled. It will be redelivered." });
		}
	}

	// #endregion

	// #region Browsing + mounting

	/** Browse one level of a connected drive, under the caller's own storage-granted connection. */
	static browse(
		params: DriveBrowseParams,
		actor: ReadActor,
	): Promise<ServiceResult<DriveBrowsePage>> {
		return signedIn(
			"browse",
			actor,
			(a) => withStorage(a, params.connectionId, (adapter) => listLevel(adapter, params)),
		);
	}

	/**
	 * One location of a connected drive for the hub: the level at the end of `folderIds`, the drive's
	 * own name and the names along the way, read in one claim of the connection's token. The trail is
	 * first-page only, because a later page extends a location already on screen.
	 */
	static browseLocation(
		input: { connectionId: string; folderIds: string[]; cursor: string | null; limit: number },
		actor: ReadActor,
	): Promise<ServiceResult<DriveLocation>> {
		const { connectionId, folderIds, cursor, limit } = input;
		return signedIn(
			"browse-location",
			actor,
			(a) =>
				withStorage(a, connectionId, async (adapter, connection) => {
					const [page, trail] = await Promise.all([
						listLevel(adapter, { connectionId, folderId: folderIds.at(-1) ?? null, cursor, limit }),
						cursor ? [] : Promise.all(folderIds.map((id) => adapter.folder?.(id) ?? null)),
					]);
					return {
						page,
						connection,
						trail: trail.flatMap((folder) => folder ? [folder] : []),
					};
				}),
		);
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
		ownerType: "user" | "team" | "business" | "enterprise";
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
