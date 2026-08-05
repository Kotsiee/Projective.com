import { getFiles, postFiles } from "./api.ts";
import { toFieldErrors } from "./respond.ts";
import {
	type ConnectionsView,
	type DriveBrowsePage,
	type DriveBrowseParams,
	DriveBrowseParamsSchema,
	type IntegrationProvider,
	type RevokeConnection,
	RevokeConnectionSchema,
	type StartConnection,
	StartConnectionSchema,
} from "@projective/types/integrations";
import {
	type AssetItem,
	type AssetOwnerType,
	type FilesSim,
	simToQuery,
} from "../types/file-types.ts";
import type { FilesResult } from "../types/results.ts";

/**
 * IntegrationsService — the THIN client controller for the connector subsystem: the provider
 * catalogue, the caller's stored authorizations, the consent handshake, browsing a connected drive,
 * and mounting one of its objects into the `/files` hub.
 *
 * The exact counterpart of {@link FilesService} and built the same way — a dumb object of named
 * methods, each validating against the Zod SSOT, forwarding to `/api/integrations/*` through
 * {@link apiFetch}, and returning a soft {@link FilesResult}. **One method here corresponds to exactly
 * one route**, so a reader moving between the two halves never has to translate: `providers` ·
 * `connections` · `start` · `completionFrom` · `revoke` · `browse` · `importAsset`.
 *
 * It shares the files feature's transport envelope rather than declaring its own, because the
 * connector subsystem has no client feature of its own — the drive picker that consumes it lives in
 * `/files`, the routes already answer through `toFilesResponse`, and a second identical envelope would
 * be a second place for the shape to drift.
 *
 * **Identity is never sent from the client.** No method here takes a `userId`, and none may grow one:
 * a connection is a stored authorization to act at a third party on someone's behalf, so a
 * client-supplied user would let a caller enumerate whose accounts are linked. The routes resolve the
 * acting principal from the session. `importAsset` does carry an `owner`, and that is a REQUEST to
 * file the object into that library which the fat service authorises — never the answer (see
 * `@server/services/files/acting-principal.ts`).
 *
 * **No token has a shape anywhere in this file, and none can.** {@link UserConnection} mirrors
 * `integrations.v_my_connections`, the definer view that physically cannot project a token column, and
 * `@projective/types/integrations` declares no secret shape at all.
 *
 * Islands import THIS, never `@server/services/integrations/*` — the import edge is what keeps the
 * credential-touching half out of the client bundle.
 */

// #region Query building

/** Append the developer simulation overlay to an existing query string (the SSOT emits a leading `&`). */
function withSim(query: string, sim?: FilesSim): string {
	return `${query}${simToQuery(sim)}`;
}

/** The same overlay where there may be no other param to hang it off. */
function simQuery(sim?: FilesSim): string {
	const q = simToQuery(sim);
	return q ? `?${q.slice(1)}` : "";
}

/** A synchronous validation failure, shaped exactly like a route's 422 so callers branch once. */
function invalid<T>(
	error: {
		issues: ReadonlyArray<{ path: ReadonlyArray<string | number | symbol>; message: string }>;
	},
	message: string,
): FilesResult<T> {
	return { ok: false, message, errors: toFieldErrors(error) };
}

// #endregion

/** How a consent round trip came back, read off the URL the callback redirected to. */
export type ConsentOutcome = "connected" | "failed";

export const IntegrationsService = {
	// #region Catalogue + connections

	/**
	 * The public provider catalogue, sort-ordered.
	 *
	 * Takes no params and filters nothing: the catalogue is DATA (`integrations.providers`), not an
	 * enum, so a connector the client has never heard of arrives as an ordinary row.
	 */
	providers(): Promise<FilesResult<IntegrationProvider[]>> {
		return getFiles<IntegrationProvider[]>("/api/integrations/providers");
	},

	/**
	 * The Settings → Integrations payload: the catalogue, the caller's own connections, and the two
	 * capability projections.
	 *
	 * `hasCalendar` and `hasConferencing` come back resolved SEPARATELY because calendar sync and
	 * conferencing are two axes, not one chip set — a user may sync a Google calendar and host on Zoom,
	 * and collapsing them would make a booking surface assume the calendar provider can mint a room.
	 */
	connections(sim?: FilesSim): Promise<FilesResult<ConnectionsView>> {
		return getFiles<ConnectionsView>(`/api/integrations/connections${simQuery(sim)}`);
	},

	// #endregion

	// #region Consent handshake

	/**
	 * Begin an OAuth consent, answering with the provider authorize URL and the opaque `state` binding
	 * the round trip.
	 *
	 * The caller then NAVIGATES the browser to `authorizeUrl` — it is not fetched. A consent screen is
	 * something a person reads and agrees to; requesting it in the background would be asking the
	 * provider to authorise a grant the user never saw.
	 *
	 * `returnTo` is validated as a same-origin PATH server-side and consumed there alongside the
	 * `state`. Passing an absolute URL is refused rather than honoured: an attacker-chosen return target
	 * turns a consent screen into an open redirect wearing this domain's credibility.
	 */
	start(
		input: StartConnection,
	): Promise<FilesResult<{ state: string; authorizeUrl: string; expiresAt: string }>> {
		const parsed = StartConnectionSchema.safeParse(input);
		if (!parsed.success) {
			return Promise.resolve(invalid(parsed.error, "That connection could not be started."));
		}
		return postFiles<{ state: string; authorizeUrl: string; expiresAt: string }>(
			"/api/integrations/start",
			parsed.data,
		);
	},

	/**
	 * The completion half of the handshake — and deliberately NOT a fetch.
	 *
	 * `/api/integrations/callback` is entered by the PROVIDER redirecting the user's browser, and it
	 * answers with a 302 rather than JSON, so there is nothing here for a client to call: by the time
	 * this code runs the exchange has already happened server-side and the page has been reloaded at
	 * the destination. All that remains is to read the coarse marker off the URL we landed on.
	 *
	 * It is coarse ON PURPOSE. The callback is unauthenticated, so distinguishing "expired state" from
	 * "unknown state" in a user-visible URL would tell a prober which states exist — the service
	 * already refuses both identically, and this reads the same two-valued answer.
	 *
	 * Returns `null` when the URL carries no marker, which is the ordinary case for a page that was not
	 * arrived at through a consent.
	 */
	completionFrom(url: string | URL | null | undefined): ConsentOutcome | null {
		if (!url) return null;
		try {
			const marker = new URL(url, "http://localhost").searchParams.get("connect");
			return marker === "connected" || marker === "failed" ? marker : null;
		} catch {
			// A malformed URL is not a failed consent — it is no consent at all, and reporting it as a
			// failure would show an error to someone who never started one.
			return null;
		}
	},

	/**
	 * Revoke a stored authorization. Terminal — reconnecting requires fresh consent.
	 *
	 * The server also deletes the vault row AND calls the provider's own revocation endpoint on the live
	 * path: leaving a token valid at the far end after the user asked us to forget it is the one failure
	 * they would never find out about.
	 */
	revoke(input: RevokeConnection): Promise<FilesResult<{ revoked: boolean }>> {
		const parsed = RevokeConnectionSchema.safeParse(input);
		if (!parsed.success) {
			return Promise.resolve(invalid(parsed.error, "That connection could not be revoked."));
		}
		return postFiles<{ revoked: boolean }>("/api/integrations/revoke", parsed.data);
	},

	// #endregion

	// #region Browsing + import

	/**
	 * Browse one level of a connected drive.
	 *
	 * Answers in the SAME `AssetItem` / `AssetFolder` shapes the hub renders, so the picker, grid, table
	 * and preview modal are literally the same components for a mounted Drive file and a hub-native
	 * upload.
	 *
	 * `folderId` and `path` are BOTH accepted because the two provider families address a location
	 * differently — `folderId` is an object id (Drive, Frame.io), `path` a key prefix for stores that
	 * have no folder objects at all (S3). `cursor` is the PROVIDER's opaque continuation token and must
	 * be echoed back verbatim; a connector that pages by token cannot be resumed from an id we invented.
	 */
	browse(params: DriveBrowseParams, sim?: FilesSim): Promise<FilesResult<DriveBrowsePage>> {
		const parsed = DriveBrowseParamsSchema.safeParse(params);
		if (!parsed.success) {
			return Promise.resolve(invalid(parsed.error, "That drive query is not valid."));
		}
		const qs = new URLSearchParams({ connectionId: parsed.data.connectionId });
		if (parsed.data.folderId) qs.set("folderId", parsed.data.folderId);
		if (parsed.data.path) qs.set("path", parsed.data.path);
		if (parsed.data.cursor) qs.set("cursor", parsed.data.cursor);
		if (parsed.data.limit) qs.set("limit", String(parsed.data.limit));
		return getFiles<DriveBrowsePage>(
			`/api/integrations/browse?${withSim(qs.toString(), sim)}`,
		);
	},

	/**
	 * Mount a connected object into the hub.
	 *
	 * **This copies no bytes** — the hub stores a reference whose size counts against the PROVIDER's
	 * quota, never ours, and the row comes back read-only. The returned {@link AssetItem} is a normal
	 * hub row, so a caller can drop it straight into the grid it is already rendering.
	 *
	 * `owner` names the library to file it into and is a REQUEST the server authorises against the
	 * session — a mount into a library the caller does not hold is refused there, not here. There is no
	 * `RevokeConnectionSchema`-style Zod shape for this payload in the SSOT yet, so the route holds the
	 * authoritative one and TypeScript holds this end; adding an `ImportAssetSchema` to
	 * `@projective/types/integrations` would let both ends validate the same declaration.
	 */
	importAsset(input: {
		connectionId: string;
		externalFileId: string;
		folderId: string | null;
		owner: { ownerType: AssetOwnerType; ownerId: string };
	}): Promise<FilesResult<AssetItem>> {
		return postFiles<AssetItem>("/api/integrations/import", {
			connectionId: input.connectionId,
			externalFileId: input.externalFileId,
			folderId: input.folderId,
			ownerType: input.owner.ownerType,
			ownerId: input.owner.ownerId,
		});
	},
	// #endregion
};
