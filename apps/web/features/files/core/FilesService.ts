import { getFiles, postFiles } from "./api.ts";
import { toFieldErrors } from "./respond.ts";
import {
	type AssetFolder,
	type AssetItem,
	type AssetListPage,
	type AssetListParams,
	AssetListParamsSchema,
	type AssetOwnerType,
	type AssetTreeNode,
	type CreateFolder,
	CreateFolderSchema,
	type CreateShare,
	CreateShareSchema,
	type DedupCheck,
	DedupCheckSchema,
	type DedupVerdict,
	type DeleteAssets,
	DeleteAssetsSchema,
	type DownloadEvent,
	type DownloadGuard,
	type DownloadHistoryPage,
	type DownloadVia,
	type FileScope,
	type FilesSim,
	type LinkAttach,
	LinkAttachSchema,
	type MoveAssets,
	MoveAssetsSchema,
	type RenameAsset,
	RenameAssetSchema,
	type RevokeShare,
	RevokeShareSchema,
	type SetVisibility,
	SetVisibilitySchema,
	type ShareLink,
	type ShareResolution,
	simToQuery,
	type StorageQuota,
	type UploadComplete,
	UploadCompleteSchema,
	type UploadInit,
	UploadInitSchema,
	type UploadTicket,
} from "../types/file-types.ts";
import type { FilesResult } from "../types/results.ts";

/**
 * FilesService — the THIN client controller for the `/files` asset hub and the Asset Picker.
 *
 * A dumb object of named methods; each validates its input against the Zod SSOT, builds a query
 * string or a JSON payload, and forwards to `/api/files/*`, returning a soft {@link FilesResult}. It
 * holds no fixtures, no query logic and no arithmetic — the fat `FilesBackendService` owns the reads
 * AND the writes (mirrors `CatalogueService` / `WalletService`).
 *
 * **One method here corresponds to exactly one method there, under the same name**, so a reader
 * moving between the two halves never has to translate: `list` · `tree` · `item` · `quota` ·
 * `dedupCheck` · `uploadInit` · `uploadComplete` · `attachLink` · `createFolder` · `rename` · `move`
 * · `remove` · `setVisibility` · `createShare` · `revokeShare` · `resolveShare` · `downloadGuard` ·
 * `recordDownload` · `history`. The payload type is the fat method's payload verbatim — the routes
 * put it in `data` unwrapped, so there is no per-endpoint envelope to remember.
 *
 * **Validation happens BEFORE the network call, and that is the point of it.** A malformed payload
 * that reaches the route comes back as a 422 the island then has to interpret; validating here turns
 * the same mistake into a synchronous field-keyed error with no round trip, no spinner and no
 * partially-applied bulk mutation. The server re-validates regardless — this is a courtesy to the
 * person typing, never a security boundary, and nothing here is trusted by the route.
 *
 * **Identity is never sent from the client, and the owner in a payload is a REQUEST rather than the
 * answer.** No method here takes an `actorId`: `downloadGuard` and `recordDownload` take an actor on
 * the FAT side and the thin route supplies it from the session, because a client-supplied one would
 * let anyone write a download into someone else's ledger or ask whether somebody else had taken a
 * copy. The same rule now covers every mutation — `uploadInit`, `attachLink` and `createFolder` still
 * carry an `ownerType`/`ownerId`, but the route derives the acting principal from
 * `ctx.state.userContext` and the fat service decides which library the write actually lands in (see
 * `@server/services/files/acting-principal.ts`). So a payload owner is a destination the caller is
 * asking for, and being refused it is a normal outcome this client must be able to render.
 *
 * **The simulation overlay travels as query params, not as a body field.** The Dev Context Switcher
 * is a client seam the server cannot see, and every axis it exposes changes data the SERVER produced,
 * so the overlay has to reach the fat service on the request itself (see `files-seam.ts` and the
 * `/wallet` precedent, Decision #55).
 */

// #region Query building
/** Serialise the asset-list params into the `/api/files/list` query string (no leading `?`). */
export function buildListQuery(params: AssetListParams): string {
	const qs = new URLSearchParams();
	qs.set("scope", params.scope);
	if (params.subjectId) qs.set("subjectId", params.subjectId);
	if (params.channelId) qs.set("channelId", params.channelId);
	if (params.folderId) qs.set("folderId", params.folderId);
	if (params.path && params.path.length > 0) {
		// Each segment is encoded independently, so a folder literally named `a/b` cannot be read back
		// as the nested pair `["a", "b"]` — the same reason the SSOT's `pathKey` encodes before joining.
		qs.set("path", params.path.map(encodeURIComponent).join("/"));
	}
	if (params.sort) qs.set("sort", params.sort);
	if (params.dir) qs.set("dir", params.dir);
	if (params.kinds && params.kinds.length > 0) qs.set("kinds", params.kinds.join(","));
	if (params.sources && params.sources.length > 0) qs.set("sources", params.sources.join(","));
	if (params.visibility && params.visibility.length > 0) {
		qs.set("visibility", params.visibility.join(","));
	}
	if (params.query) qs.set("query", params.query);
	if (params.cursor) qs.set("cursor", params.cursor);
	if (params.limit) qs.set("limit", String(params.limit));
	return qs.toString();
}

/**
 * Append a simulation overlay to a query string that already has at least one param.
 *
 * The SSOT's `simToQuery` returns a **leading `&`** by design, so it composes onto an existing query
 * without the caller having to remember a separator — the alternative silently concatenates onto the
 * previous param the one time somebody forgets.
 */
function withSim(query: string, sim?: FilesSim): string {
	return `${query}${simToQuery(sim)}`;
}

/** The same overlay for a POST, where there may be no other param to hang it off. */
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

export const FilesService = {
	// #region Reads
	/**
	 * List one location: the assets, the child folders, the breadcrumb trail, the location's
	 * `readOnly` fact and — on a `hub` read — the owner's allowance, in one round trip.
	 */
	list(params: AssetListParams, sim?: FilesSim): Promise<FilesResult<AssetListPage>> {
		const parsed = AssetListParamsSchema.safeParse(params);
		if (!parsed.success) {
			return Promise.resolve(invalid(parsed.error, "That file query is not valid."));
		}
		return getFiles<AssetListPage>(`/api/files/list?${withSim(buildListQuery(parsed.data), sim)}`);
	},

	/** The navigation tree for a scope — the library, the mounted engagements and the drives. */
	tree(params: {
		scope: FileScope;
		subjectId?: string | null;
		ownerType: AssetOwnerType;
		ownerId: string;
	}, sim?: FilesSim): Promise<FilesResult<AssetTreeNode[]>> {
		const qs = new URLSearchParams({
			scope: params.scope,
			ownerType: params.ownerType,
			ownerId: params.ownerId,
		});
		if (params.subjectId) qs.set("subjectId", params.subjectId);
		return getFiles<AssetTreeNode[]>(`/api/files/tree?${withSim(qs.toString(), sim)}`);
	},

	/** One asset's full row (the preview modal's deep link, and a refresh after a mutation). */
	item(id: string, sim?: FilesSim): Promise<FilesResult<AssetItem>> {
		const qs = new URLSearchParams({ id });
		return getFiles<AssetItem>(`/api/files/item?${withSim(qs.toString(), sim)}`);
	},

	/** A principal's resolved storage allowance (the meter, the nudge and the upload pre-flight). */
	quota(
		ownerType: AssetOwnerType,
		ownerId: string,
		sim?: FilesSim,
	): Promise<FilesResult<StorageQuota>> {
		const qs = new URLSearchParams({ ownerType, ownerId });
		return getFiles<StorageQuota>(`/api/files/quota?${withSim(qs.toString(), sim)}`);
	},
	// #endregion

	// #region Upload handshake
	/**
	 * Pre-flight a whole drop against the duplicate index — one round trip for up to `DEDUP_BATCH_MAX`
	 * files, answered BEFORE any bytes move, which is the only moment at which "you already have this"
	 * saves anybody anything.
	 *
	 * Verdicts come back positionally aligned with `input.fingerprints`.
	 */
	dedupCheck(input: DedupCheck, sim?: FilesSim): Promise<FilesResult<DedupVerdict[]>> {
		const parsed = DedupCheckSchema.safeParse(input);
		if (!parsed.success) {
			return Promise.resolve(invalid(parsed.error, "That duplicate check is not valid."));
		}
		return postFiles<DedupVerdict[]>(`/api/files/dedup${simQuery(sim)}`, parsed.data);
	},

	/** Step 1 — declare the incoming file and receive a scoped, short-lived signed-URL ticket. */
	uploadInit(input: UploadInit, sim?: FilesSim): Promise<FilesResult<UploadTicket>> {
		const parsed = UploadInitSchema.safeParse(input);
		if (!parsed.success) {
			return Promise.resolve(invalid(parsed.error, "That upload could not be started."));
		}
		return postFiles<UploadTicket>(`/api/files/upload-init${simQuery(sim)}`, parsed.data);
	},

	/**
	 * Step 3 — the object landed; finalise the row so it leaves `pending_upload`.
	 *
	 * Step 2 is not here on purpose: the browser PUTs the bytes straight at the ticket's `signedUrl`
	 * with the headers it returned. Routing a 500 MB body through a Deno handler would occupy a
	 * request worker for minutes and buy nothing.
	 */
	uploadComplete(input: UploadComplete): Promise<FilesResult<AssetItem>> {
		const parsed = UploadCompleteSchema.safeParse(input);
		if (!parsed.success) {
			return Promise.resolve(invalid(parsed.error, "That upload could not be finalised."));
		}
		return postFiles<AssetItem>("/api/files/upload-complete", parsed.data);
	},

	/**
	 * Store a web link as a first-class asset.
	 *
	 * The SSOT's `https:`-only regex is a cheap gate, not the boundary — the server still has to
	 * resolve the host and refuse loopback / link-local / private ranges before it fetches the page
	 * for a title and favicon, because an unguarded ingest fetch is a textbook SSRF.
	 */
	attachLink(input: LinkAttach, sim?: FilesSim): Promise<FilesResult<AssetItem>> {
		const parsed = LinkAttachSchema.safeParse(input);
		if (!parsed.success) {
			return Promise.resolve(invalid(parsed.error, "That link could not be attached."));
		}
		return postFiles<AssetItem>(`/api/files/link${simQuery(sim)}`, parsed.data);
	},
	// #endregion

	// #region Mutations
	/** Create a folder. `parentId: null` creates it at the library root. */
	createFolder(input: CreateFolder): Promise<FilesResult<AssetFolder>> {
		const parsed = CreateFolderSchema.safeParse(input);
		if (!parsed.success) {
			return Promise.resolve(invalid(parsed.error, "That folder could not be created."));
		}
		return postFiles<AssetFolder>("/api/files/folder", parsed.data);
	},

	/** Rename one asset. The extension is preserved server-side — a person edits a name, not a type. */
	rename(input: RenameAsset): Promise<FilesResult<AssetItem>> {
		const parsed = RenameAssetSchema.safeParse(input);
		if (!parsed.success) {
			return Promise.resolve(invalid(parsed.error, "That name is not valid."));
		}
		return postFiles<AssetItem>("/api/files/rename", parsed.data);
	},

	/** Move assets into a folder. `targetFolderId: null` moves them to the library root. */
	move(input: MoveAssets): Promise<FilesResult<{ moved: number }>> {
		const parsed = MoveAssetsSchema.safeParse(input);
		if (!parsed.success) {
			return Promise.resolve(invalid(parsed.error, "Those files could not be moved."));
		}
		return postFiles<{ moved: number }>("/api/files/move", parsed.data);
	},

	/**
	 * Delete assets. Nothing is hard-deleted (root CLAUDE.md §5) — this stamps `deleted_at`, so the
	 * deletion is recoverable and a share link that pointed at the asset stops resolving instead of
	 * failing loudly.
	 */
	remove(input: DeleteAssets): Promise<FilesResult<{ removed: number }>> {
		const parsed = DeleteAssetsSchema.safeParse(input);
		if (!parsed.success) {
			return Promise.resolve(invalid(parsed.error, "Those files could not be deleted."));
		}
		return postFiles<{ removed: number }>("/api/files/delete", parsed.data);
	},

	/**
	 * Change the privacy scope of assets and/or folders in ONE request.
	 *
	 * Both collections ride one payload because the control that raises them is one control: a person
	 * selecting a mixed set expects one answer, not two requests with a window in which half of their
	 * selection is public and half is not.
	 */
	setVisibility(input: SetVisibility): Promise<FilesResult<AssetItem[]>> {
		const parsed = SetVisibilitySchema.safeParse(input);
		if (!parsed.success) {
			return Promise.resolve(invalid(parsed.error, "That privacy change is not valid."));
		}
		return postFiles<AssetItem[]>("/api/files/visibility", parsed.data);
	},
	// #endregion

	// #region Sharing
	/** Mint a read-only share link over exactly one asset or one folder. */
	createShare(input: CreateShare): Promise<FilesResult<ShareLink>> {
		const parsed = CreateShareSchema.safeParse(input);
		if (!parsed.success) {
			return Promise.resolve(invalid(parsed.error, "That share link could not be created."));
		}
		return postFiles<ShareLink>("/api/files/share-create", parsed.data);
	},

	/**
	 * Revoke a share link. Terminal — re-sharing mints a NEW slug, so a leaked URL stays dead.
	 *
	 * An unknown slug and an already-revoked one both answer `{ revoked: false }` with a 200, so the
	 * response cannot be used to probe whether a slug the caller does not hold exists.
	 */
	revokeShare(input: RevokeShare): Promise<FilesResult<{ revoked: boolean }>> {
		const parsed = RevokeShareSchema.safeParse(input);
		if (!parsed.success) {
			return Promise.resolve(invalid(parsed.error, "That share link could not be revoked."));
		}
		return postFiles<{ revoked: boolean }>("/api/files/share-revoke", parsed.data);
	},

	/**
	 * Resolve a share slug.
	 *
	 * The SERVICE distinguishes not-found from expired from revoked from exhausted so an owner's audit
	 * and the platform's abuse metering can tell them apart; **the route collapses all four into one
	 * identical answer**, because a distinguishable failure confirms that a slug was real — the only
	 * bit an enumeration attack needs. A caller here must therefore treat every non-`ok` resolution as
	 * the same outcome and must never render which one it was.
	 *
	 * `userRef` is the opaque, server-minted per-recipient reference carried on the share URL. It is
	 * never a handle, a user id or an email — a share URL gets forwarded and pasted into public
	 * places, and personal data must never travel in a query string (root CLAUDE.md §Privacy).
	 */
	resolveShare(
		slug: string,
		userRef?: string | null,
		sim?: FilesSim,
	): Promise<FilesResult<ShareResolution>> {
		const qs = new URLSearchParams({ slug });
		if (userRef) qs.set("u", userRef);
		return getFiles<ShareResolution>(`/api/files/share-resolve?${withSim(qs.toString(), sim)}`);
	},
	// #endregion

	// #region Downloads
	/**
	 * Whether the acting viewer has already taken a copy — asked before a download so the hub can
	 * offer the copy they have instead of silently handing over a second one.
	 *
	 * The actor is NOT sent: the route reads it from the session (see the module note). Only the
	 * anonymous share case carries a `deviceFingerprint`, which is an opaque rotating token and never
	 * derived from anything stable about the person or their network.
	 */
	downloadGuard(
		assetId: string,
		deviceFingerprint?: string | null,
	): Promise<FilesResult<DownloadGuard>> {
		const qs = new URLSearchParams({ assetId });
		if (deviceFingerprint) qs.set("device", deviceFingerprint);
		return getFiles<DownloadGuard>(`/api/files/download-guard?${qs.toString()}`);
	},

	/** Append a download to the ledger. The actor comes from the session, never from this payload. */
	recordDownload(input: {
		assetId: string;
		via: DownloadVia;
		shareSlug?: string | null;
		deviceFingerprint?: string | null;
	}): Promise<FilesResult<DownloadEvent>> {
		return postFiles<DownloadEvent>("/api/files/download-record", {
			assetId: input.assetId,
			via: input.via,
			shareSlug: input.shareSlug ?? null,
			deviceFingerprint: input.deviceFingerprint ?? null,
		});
	},

	/** A cursor-paged slice of the download ledger for one asset, one actor, or the whole library. */
	history(params: {
		assetId?: string;
		actorId?: string;
		cursor?: string | null;
		limit?: number;
	} = {}): Promise<FilesResult<DownloadHistoryPage>> {
		const qs = new URLSearchParams();
		if (params.assetId) qs.set("assetId", params.assetId);
		if (params.actorId) qs.set("actorId", params.actorId);
		if (params.cursor) qs.set("cursor", params.cursor);
		if (params.limit) qs.set("limit", String(params.limit));
		const q = qs.toString();
		return getFiles<DownloadHistoryPage>(`/api/files/history${q ? `?${q}` : ""}`);
	},
	// #endregion
};
