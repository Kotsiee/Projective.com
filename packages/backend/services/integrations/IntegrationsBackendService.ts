import type { AssetItem, AssetOwnerType, FilesSim } from "@projective/types/files";
import {
	type AssetOwnerRef,
	authoriseOwner,
	type FilesActor,
	fixtureOwner,
} from "../files/acting-principal.ts";
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
import { isIntegrationsBackendLive } from "../../core/supabase.ts";
import * as fx from "./connections-fixtures.ts";
import { createGoogleDriveAdapter } from "./adapters/GoogleDriveAdapter.ts";
import { createDropboxAdapter } from "./adapters/DropboxAdapter.ts";
import { createFrameIoAdapter } from "./adapters/FrameIoAdapter.ts";
import { createS3Adapter } from "./adapters/S3Adapter.ts";
import type { StorageAdapter, StorageAdapterFactory } from "./adapters/StorageAdapter.ts";
import { importExternalAsset } from "../files/assets-fixtures.ts";

/**
 * IntegrationsBackendService — the FAT half of the connector subsystem: the provider catalogue, a
 * user's stored authorizations, the consent handshake, browsing a connected drive, and importing one of
 * its objects into the `/files` hub.
 *
 * Gated by {@link isIntegrationsBackendLive} (`INTEGRATIONS_BACKEND_LIVE`, default off). It is a
 * SEPARATE gate from `FILES_BACKEND_LIVE` on purpose: the two surfaces share a screen but not a trust
 * model. A live files backend touches only our own storage under the caller's RLS; a live integrations
 * backend makes outbound calls to a third party carrying somebody's stored credential. One flag would
 * mean enabling the hub silently enables that.
 *
 * **Every method forks on that gate as its first statement**, including the two that reach an adapter.
 * {@link browse} and {@link importAsset} are the sharpest cases: an adapter call is the moment a
 * request leaves this process carrying a credential, so the branch that decides whether it may has to
 * be visible at the call site rather than trusted to exist four files away. Each LIVE branch names the
 * work it will do and falls back to the fixtures with zero shape churn.
 *
 * ### Three rules this service exists to hold
 *
 * **Authentication ≠ authorization.** The Google OAuth in `features/auth/` is SIGN-IN — GoTrue owns it
 * and retains no third-party API token. Everything here is a separate, additional consent: a long-lived
 * API grant the platform stores to read a drive or a free/busy window. The two flows and their token
 * stores are never conflated, and a user who signed in with Google has granted this service nothing.
 *
 * **Every data touch is capability-scoped.** A connection's `grantedKinds` may be NARROWER than the
 * provider's `capabilities` — a user can grant `calendar` and withhold `storage` at the same vendor —
 * so authority is checked against what was granted, never against what the vendor can do.
 *
 * **No token ever crosses this boundary.** {@link UserConnection} mirrors
 * `integrations.v_my_connections`, the definer view that physically cannot project a token column.
 * Credentials are reached only through `./token-vault.ts`, service-role, and are held for the duration
 * of one adapter call.
 *
 * ### Scope flagged (surface, do not silently resolve)
 *
 * Connections are **per-user**, with no owner axis — the freelancer-workspace scope. A team or business
 * SHARED drive connection would need an owner dimension on `integrations.user_connections` and a
 * membership predicate on its policies; entity drives are out of scope here and deferred (Decision #59).
 */
export class IntegrationsBackendService {
	// #region Catalogue + connections

	/** The public provider catalogue — non-sensitive rows, sort-ordered. */
	static async providers(): Promise<ServiceResult<IntegrationProvider[]>> {
		if (!isIntegrationsBackendLive()) return await Promise.resolve(ok(fx.listProviders()));
		// LIVE: `SELECT … FROM integrations.providers WHERE is_enabled ORDER BY sort_order` — the
		// catalogue is DATA, so adding a connector stays a seed row. Not yet implemented; fall back to
		// the fixtures with zero shape churn.
		return await Promise.resolve(ok(fx.listProviders()));
	}

	/**
	 * The Settings → Integrations payload: the catalogue, the caller's own connections, and the two
	 * capability convenience projections.
	 *
	 * `hasCalendar` and `hasConferencing` are resolved SEPARATELY because calendar sync and conferencing
	 * are two axes, not one chip set — a user may sync a Google calendar and host on Zoom, and collapsing
	 * them would make the booking flow assume the calendar provider can also mint a room.
	 */
	static async connections(params: {
		userId: string;
		sim?: FilesSim;
	}): Promise<ServiceResult<ConnectionsView>> {
		if (!isIntegrationsBackendLive()) return await Promise.resolve(connectionsView(params));
		// LIVE: the catalogue read above, plus `SELECT * FROM integrations.v_my_connections` — the
		// definer view that physically cannot project a token column, so no secret can reach the
		// response even by mistake. Not yet implemented; fall back to the fixtures.
		return await Promise.resolve(connectionsView(params));
	}

	// #endregion

	// #region Consent handshake

	/**
	 * Begin an OAuth consent. Returns the provider authorize URL and the opaque `state` binding it.
	 *
	 * `state` is the CSRF binding for the whole round trip: the callback arrives as an unauthenticated
	 * request from the provider's redirect, so a callback carrying a state we never issued is refused
	 * outright. `returnTo` is validated as a SAME-ORIGIN PATH server-side and never echoed back raw — an
	 * attacker-chosen return URL turns a consent screen into an open redirect that borrows our domain's
	 * credibility.
	 *
	 * A provider whose `authScheme` is `aws_sigv4` has no authorization server at all, so it is refused
	 * here rather than sent to a URL that does not exist: S3 connects through a credential form, and
	 * presenting that as a consent screen would misdescribe what the user is handing over.
	 */
	static async startConnection(
		input: StartConnection,
		params: { userId: string },
	): Promise<ServiceResult<{ state: string; authorizeUrl: string; expiresAt: string }>> {
		if (!isIntegrationsBackendLive()) {
			return await Promise.resolve(beginConsentFlow(input, params, false));
		}
		// LIVE: mint the `state` into `integrations` alongside the PKCE verifier and the validated
		// `returnTo`, then build the provider's real authorize endpoint with `scope` from `grantedKinds`
		// (defaulting to `defaultScopes`) and `redirect_uri` from APP_URL. Not yet implemented; fall back
		// to the fixtures, which mint the same `state` and withhold only the outbound URL.
		return await Promise.resolve(beginConsentFlow(input, params, true));
	}

	/**
	 * Complete a consent: exchange the code, seal the token, and move the connection to `active`.
	 *
	 * The `state` is single-use — a replayed callback must not authorise a second time. The exchanged
	 * token goes STRAIGHT into `./token-vault.ts` and is never returned, logged or attached to the
	 * result: the caller receives a connection row, which by construction cannot carry one.
	 */
	static async completeConnection(input: {
		state: string;
		code: string;
	}): Promise<ServiceResult<UserConnection>> {
		if (!isIntegrationsBackendLive()) return await Promise.resolve(activateFromConsent(input));
		// LIVE: exchange `code` at the provider's token endpoint → `seal()` the access + refresh tokens
		// into `integrations.connection_secrets` under the active `key_id` → upsert the connection row →
		// register a webhook subscription where supported, recording its `expires_at` so the renewal cron
		// can keep it alive (an unrenewed channel stops delivering silently). Not yet implemented; fall
		// back to the fixtures, which consume the same single-use `state` and exchange nothing.
		return await Promise.resolve(activateFromConsent(input));
	}

	/**
	 * Revoke a stored authorization. Terminal — reconnecting requires fresh consent.
	 *
	 * The live path also deletes the `connection_secrets` row AND calls the provider's own revocation
	 * endpoint. Leaving a token valid at the far end after the user asked us to forget it is the one
	 * failure they would never find out about.
	 */
	static async revokeConnection(
		input: RevokeConnection,
		params: { userId: string },
	): Promise<ServiceResult<{ revoked: boolean }>> {
		if (!isIntegrationsBackendLive()) return await Promise.resolve(dropConnection(input, params));
		// LIVE: delete the `integrations.connection_secrets` row, POST the provider's own revocation
		// endpoint, and move the connection to `revoked` — in that order, so a failure at the far end
		// still leaves us holding no token. Not yet implemented; fall back to the fixtures.
		return await Promise.resolve(dropConnection(input, params));
	}

	// #endregion

	// #region Browsing + import

	/**
	 * Browse one level of a connected drive, projected into the SAME row shapes the `/files` hub renders.
	 *
	 * Returning `AssetItem` / `AssetFolder` rather than a connector row is the point: the picker, grid,
	 * table and preview modal are literally the same components for a mounted Drive file and a hub-native
	 * upload, so the two cannot drift apart in how they are drawn.
	 *
	 * Paging is the PROVIDER's — `nextCursor` is their opaque token echoed back verbatim, because a
	 * connector that pages by continuation token cannot be resumed from an id we invented.
	 *
	 * **The gate is checked HERE, not only inside the adapter.** This is the boundary at which a request
	 * would leave the process carrying somebody's stored credential, so the decision to allow that has to
	 * be readable at the call site — an adapter that gates its own `list` protects nothing the day a
	 * fifth adapter forgets to.
	 */
	static async browse(
		params: DriveBrowseParams,
		opts?: { userId?: string; sim?: FilesSim },
	): Promise<ServiceResult<DriveBrowsePage>> {
		if (!isIntegrationsBackendLive()) return await listDrive(params, opts);
		// LIVE: resolve the connection from `integrations.v_my_connections`, unseal its token through
		// `./token-vault.ts` for the duration of THIS call only, and hand the adapter a real
		// `accessToken`. Not yet implemented; fall back to the stub corpora, which reach no network.
		return await listDrive(params, opts);
	}
	/**
	 * Mount a connected object into the hub.
	 *
	 * **This copies no bytes.** The hub stores a REFERENCE — the row carries `source !== "supabase"`, its
	 * `external` back-reference, and a size counted against the PROVIDER's quota, never ours. Copying
	 * instead would double every large file, charge the user for storage they already pay someone else
	 * for, and immediately fork the two copies the first time either side is edited.
	 *
	 * The imported row is read-only for the same reason the drive section is: the hub exists so a person
	 * can find and attach what they already have, not so it becomes a second write path into someone
	 * else's system of record.
	 *
	 * **Two authorities have to agree, and they are different questions.** The CONNECTION must belong to
	 * the caller and carry a `storage` grant — that is what makes reading the remote object legitimate —
	 * and the destination LIBRARY must be one the session evidences, which is what stops a mount from
	 * filing someone else's Drive object into a team's hub. Checking only the first is how a read
	 * permission quietly becomes a write one.
	 */
	static async importAsset(input: {
		connectionId: string;
		externalFileId: string;
		folderId: string | null;
		ownerType: AssetOwnerType;
		ownerId: string;
	}, actor: FilesActor): Promise<ServiceResult<AssetItem>> {
		if (!isIntegrationsBackendLive()) return await mountAsset(input, fixtureOwner(actor), null);
		// LIVE: the same two checks, then an insert into `files.items` with `source = <provider>` and the
		// `external` back-reference — no bytes and no quota consumption. Not yet implemented; fall back
		// to the fixtures.
		const owner = authoriseOwner(actor, { ownerType: input.ownerType, ownerId: input.ownerId });
		if (!owner) {
			return await Promise.resolve(fail(403, { message: "You can't add files to that library." }));
		}
		return await mountAsset(input, owner, actor.userId);
	}

	// #endregion
}

// #region Fixture-backed bodies
//
// Each is the stub answer for one method, extracted so the method itself is a gate fork and nothing
// else — the same shape as `../files/FilesBackendService.ts`.

/** The Settings → Integrations payload. */
function connectionsView(
	params: { userId: string; sim?: FilesSim },
): ServiceResult<ConnectionsView> {
	const rows = fx.withOverrides(fx.listConnections(params.userId, params.sim));
	return ok({
		providers: fx.listProviders(),
		connections: rows,
		hasCalendar: rows.some((c) => c.status === "active" && c.grantedKinds.includes("calendar")),
		hasConferencing: rows.some((c) =>
			c.status === "active" && c.grantedKinds.includes("conferencing")
		),
		activeConferencingProvider: rows.find(
			(c) => c.status === "active" && c.grantedKinds.includes("conferencing"),
		)?.providerSlug ?? null,
	});
}

/**
 * Mint the consent `state` and answer with the authorize URL.
 *
 * `live` decides only whether an OUTBOUND url is handed back: with the gate off the state is still
 * minted and still single-use, so the whole round trip is exercisable without anything leaving the
 * process.
 */
function beginConsentFlow(
	input: StartConnection,
	params: { userId: string },
	live: boolean,
): ServiceResult<{ state: string; authorizeUrl: string; expiresAt: string }> {
	const provider = fx.findProvider(input.providerSlug);
	if (!provider) return fail(404, { message: "No such provider." });
	if (!provider.isEnabled) return fail(409, { message: `${provider.label} is not available.` });
	if (provider.authScheme === "aws_sigv4") {
		return fail(422, {
			message: `${provider.label} connects with an access key, not a consent screen.`,
			errors: { providerSlug: "Use the credential form for this provider." },
		});
	}

	const state = fx.beginConsent(params.userId, provider.slug, input.returnTo ?? null);
	return ok({
		state,
		authorizeUrl: live
			? `/api/integrations/authorize/${provider.slug}?state=${encodeURIComponent(state)}`
			: "#stub-consent",
		expiresAt: new Date(Date.now() + 10 * 60_000).toISOString(),
	});
}

/** Consume a single-use consent `state` and activate its connection. */
function activateFromConsent(
	input: { state: string; code: string },
): ServiceResult<UserConnection> {
	const pending = fx.consumeConsent(input.state);
	if (!pending) {
		// Deliberately not "expired" vs "unknown": the callback is unauthenticated, and a
		// distinguishable answer tells a prober which states exist.
		return fail(400, { message: "That consent could not be completed." });
	}
	const connection = fx.activateConnection(pending.slug);
	if (!connection) return fail(404, { message: "No such provider." });
	return ok(connection, { message: `${connection.providerLabel} connected.` });
}

/** Revoke one stored authorization the caller holds. */
function dropConnection(
	input: RevokeConnection,
	params: { userId: string },
): ServiceResult<{ revoked: boolean }> {
	const connection = fx.findConnection(input.connectionId);
	if (!connection || connection.userId !== params.userId) {
		return fail(404, { message: "No such connection." });
	}
	const revoked = fx.revokeConnectionRow(input.connectionId);
	return ok({ revoked }, {
		message: revoked ? "Connection revoked." : "That connection is already closed.",
	});
}

/** List one level of a connected drive through its adapter. */
async function listDrive(
	params: DriveBrowseParams,
	opts?: { userId?: string; sim?: FilesSim },
): Promise<ServiceResult<DriveBrowsePage>> {
	const connection = fx.findConnection(params.connectionId, opts?.sim);
	if (!connection) return fail(404, { message: "No such connection." });
	if (opts?.userId && connection.userId !== opts.userId) {
		return fail(404, { message: "No such connection." });
	}

	// Authority is checked against what was GRANTED, never against what the vendor can do: a user
	// may hold a calendar grant at a provider whose catalogue row also advertises storage. The
	// check goes through the SSOT's own `connectionSupports` rather than a local condition, so the
	// definition of "may act" cannot diverge between this service and the settings surface.
	if (!connection.grantedKinds.includes("storage")) {
		return fail(403, { message: `${connection.providerLabel} isn't connected for files.` });
	}
	if (!connectionSupports(connection, "storage")) {
		return fail(409, {
			// `recoverable` is the axis the copy branches on, not the status name: a `degraded` or
			// `expired` grant is refreshable, so the surface offers reconnect. A `revoked` one is
			// terminal — offering reconnect would imply a stored grant that no longer exists, and the
			// retry would fail with nothing to explain it.
			message: connectionIsRecoverable(connection.status)
				? `${connection.providerLabel} needs reconnecting.`
				: `${connection.providerLabel} needs to be connected again.`,
			errors: { connection: connection.status },
		});
	}

	const adapter = adapterFor(connection);
	if (!adapter) return fail(422, { message: "That provider can't be browsed." });

	const limit = Math.min(200, Math.max(1, params.limit ?? 60));
	const listing = await adapter.list(
		{ folderId: params.folderId ?? null, path: params.path ?? null },
		params.cursor ?? null,
		limit,
	);
	return ok({
		entries: listing.entries,
		folders: listing.folders,
		hasMore: listing.hasMore,
		nextCursor: listing.nextCursor,
	});
}

/**
 * Mount one remote object into `owner`'s library as a reference row.
 *
 * `requireUserId` is the caller the connection must belong to, or `null` to skip that check. It is only
 * ever passed on the live path: every fixture connection belongs to the one fixture viewer, so
 * comparing a real session id against it would refuse every stubbed import and prove nothing. A
 * mismatch answers 404 rather than 403, matching {@link listDrive}, so the response cannot be used to
 * confirm that a connection id exists.
 */
async function mountAsset(
	input: {
		connectionId: string;
		externalFileId: string;
		folderId: string | null;
	},
	owner: AssetOwnerRef,
	requireUserId: string | null,
): Promise<ServiceResult<AssetItem>> {
	const connection = fx.findConnection(input.connectionId);
	if (!connection) return fail(404, { message: "No such connection." });
	if (requireUserId !== null && connection.userId !== requireUserId) {
		return fail(404, { message: "No such connection." });
	}
	if (!connection.grantedKinds.includes("storage")) {
		return fail(403, { message: `${connection.providerLabel} isn't connected for files.` });
	}

	const adapter = adapterFor(connection);
	if (!adapter) return fail(422, { message: "That provider can't be browsed." });

	const remote = await adapter.metadata(input.externalFileId);
	if (!remote) return fail(404, { message: "That file is no longer available." });

	const mounted = importExternalAsset({
		...remote,
		folderId: input.folderId,
		ownerType: owner.ownerType,
		ownerId: owner.ownerId,
		canManage: false,
	});
	return ok(mounted, { status: 201, message: `Added from ${connection.providerLabel}.` });
}

// #endregion

// #region Adapter registry

/**
 * The storage adapters, keyed by provider slug.
 *
 * A registry rather than a switch so adding a connector is one entry plus one file — the same reason
 * the provider catalogue is a data table and not an enum. A slug with no adapter is a provider that
 * advertises `storage` and cannot serve it, which is a configuration error the caller must see rather
 * than a silent empty listing.
 */
const ADAPTERS: Readonly<Record<string, StorageAdapterFactory>> = {
	google_drive: createGoogleDriveAdapter,
	dropbox: createDropboxAdapter,
	frameio: createFrameIoAdapter,
	s3: createS3Adapter,
};

/**
 * Construct the adapter for a connection.
 *
 * `accessToken` is `null` here and must STAY null while the gate is off — the live path resolves it
 * through `./token-vault.ts` under the service role, holds it for one request, and never logs it.
 */
function adapterFor(connection: UserConnection): StorageAdapter | null {
	const factory = ADAPTERS[connection.providerSlug];
	if (!factory) return null;
	return factory({ connection, accessToken: null });
}

// #endregion
