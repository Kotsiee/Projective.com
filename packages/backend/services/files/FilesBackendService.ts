import type {
	AssetFolder,
	AssetItem,
	AssetListPage,
	AssetListParams,
	AssetOwnerType,
	AssetTreeNode,
	CreateFolder,
	CreateShare,
	DedupCheck,
	DedupVerdict,
	DeleteAssets,
	DownloadEvent,
	DownloadGuard,
	DownloadHistoryPage,
	DownloadVia,
	FileObjectTier,
	LinkAttach,
	MoveAssets,
	RenameAsset,
	RevokeShare,
	SetVisibility,
	ShareLink,
	ShareResolution,
	StorageQuota,
	UploadComplete,
	UploadInit,
	UploadTicket,
} from "@projective/types/files";
import { fail, ok, type ServiceResult } from "../ServiceResult.ts";
import { canReadLive, type ReadActor } from "../read-actor.ts";
import {
	dedupVerdicts,
	isActingOwner,
	listDrive,
	listHub,
	listShare,
	ownerOfActor,
	readAsset,
	readDownloadGuard,
	readHistory,
	readQuota,
	readTree,
	resolveShareSlug,
} from "./live-library.ts";
import {
	attachLink,
	createFolder,
	createShare,
	moveAssets,
	recordDownload,
	removeAssets,
	renameAsset,
	revokeShare,
	setVisibility,
} from "./live-library-writes.ts";
import { completeUpload, initUpload } from "./live-uploads.ts";
import { objectUrlFor } from "./live-objects.ts";

/**
 * FilesBackendService — the FAT half of the `/files` asset hub (thin routes / fat services, root
 * CLAUDE.md §2). It owns the library reads (a location, the navigation tree, one asset, the storage
 * allowance, the download ledger), the upload handshake, every mutation over what is stored, the
 * read-only share capability, and the read decision behind the private-object route — each returning a
 * transport-agnostic {@link ServiceResult}. The thin `/api/files/*` routes parse, Zod-validate and
 * delegate here; islands never reach it.
 *
 * Everything runs LIVE against `files.*`: reads and ordinary writes under the caller's own session, so
 * the RLS policies decide what is theirs; the pipeline steps a client may not take (promoting an upload,
 * appending to the download ledger, reading a row a share link grants) as the service role, and only
 * after the caller's own session or a validated slug has earned them.
 *
 * ### Invariants this service holds
 *
 * **`canManage` and `downloadedByViewer` are server-derived on every row** — the first is the UPDATE
 * policy's own predicate, the second the viewer's ledger, and neither is inferred client-side.
 *
 * **The library a write lands in is the acting context's**, resolved from the session. A payload's
 * owner is a REQUEST, honoured only when it names that library.
 *
 * **Quota enforcement is fail-open** until `storage_quota_enforced` is flipped by a human; until then
 * an upload over the allowance is metered and warned about, not refused.
 *
 * A signed-out caller gets a 401 on everything but the share doors, and an unexpected failure a 503 —
 * never a sample library.
 */

type Result<T> = ServiceResult<T>;
type Actor = ReadActor & { accessToken: string };
type Outcome<T> =
	| { ok: true; data: T; status?: number; message?: string }
	| { ok: false; status: number; message: string; errors?: Record<string, string> };

const SIGNED_OUT = "Sign in to use your files.";
const UNREACHABLE = "We couldn't reach your files just now. Try again in a moment.";

/** A module outcome as a transport-agnostic result. */
function toResult<T>(outcome: Outcome<T>): Result<T> {
	return outcome.ok
		? ok(outcome.data, { status: outcome.status, message: outcome.message })
		: fail(outcome.status, { message: outcome.message, errors: outcome.errors }) as Result<T>;
}

/** Run a signed-in body: 401 without a session, 503 on an unexpected failure. */
async function signedIn<T>(label: string, actor: ReadActor, run: (a: Actor) => Promise<Result<T>>): Promise<Result<T>> {
	if (!canReadLive(actor)) return fail(401, { message: SIGNED_OUT }) as Result<T>;
	try {
		return await run(actor);
	} catch (error) {
		console.error(`[files:${label}]`, error instanceof Error ? error.message : error);
		return fail(503, { message: UNREACHABLE }) as Result<T>;
	}
}

/** Run an anonymous-capable body: 503 on an unexpected failure. */
async function anyone<T>(label: string, run: () => Promise<Result<T>>): Promise<Result<T>> {
	try {
		return await run();
	} catch (error) {
		console.error(`[files:${label}]`, error instanceof Error ? error.message : error);
		return fail(503, { message: UNREACHABLE }) as Result<T>;
	}
}

export class FilesBackendService {
	// #region Reads

	/**
	 * One location: a folder of the acting library (with its child folders, breadcrumbs and the
	 * allowance), a mounted engagement (read-only), a connected drive (read-only), or a share link's
	 * contents (for anyone holding the slug). Engagement scopes are served by their own domains'
	 * files reads, so they are refused here rather than answered twice.
	 */
	static list(params: AssetListParams, actor: ReadActor): Promise<Result<AssetListPage>> {
		switch (params.scope) {
			case "share": {
				const slug = params.subjectId ?? "";
				return anyone("list-share", async () => slug ? toResult(await listShare(slug, params)) : fail(404, { message: "Not found." }) as Result<AssetListPage>);
			}
			case "hub":
				return signedIn("list", actor, async (a) => toResult(await listHub(a, params)));
			case "drive":
				return signedIn("list-drive", actor, async (a) =>
					params.subjectId
						? toResult(await listDrive(a, params.subjectId, params))
						: fail(422, { message: "That view needs a connection." }) as Result<AssetListPage>);
			default:
				return Promise.resolve(
					fail(422, { message: "That view is read through its own workspace." }) as Result<AssetListPage>,
				);
		}
	}

	/** The `/files` navigation tree: the acting library, the mounted engagements, the connected drives. */
	static tree(actor: ReadActor): Promise<Result<AssetTreeNode[]>> {
		return signedIn("tree", actor, async (a) => ok(await readTree(a)));
	}

	/** One asset the caller may read. */
	static item(id: string, actor: ReadActor): Promise<Result<AssetItem>> {
		return signedIn("item", actor, async (a) => {
			const item = await readAsset(a, id);
			return item ? ok(item) : fail(404, { message: "No such file." }) as Result<AssetItem>;
		});
	}

	/**
	 * A library's storage allowance. `owner` defaults to the acting library; naming another is refused
	 * (the database refuses it too — an allowance is a fact about someone's subscription).
	 */
	static quota(actor: ReadActor, owner?: { ownerType: AssetOwnerType; ownerId: string }): Promise<Result<StorageQuota>> {
		return signedIn("quota", actor, async (a) => {
			const target = owner ?? ownerOfActor(a);
			if (owner && !isActingOwner(a, owner)) {
				return fail(403, { message: "That allowance isn't yours to read." }) as Result<StorageQuota>;
			}
			return toResult(await readQuota(a, target));
		});
	}

	// #endregion

	// #region Upload handshake

	/** Pre-flight content fingerprints against the acting library, before any bytes move. */
	static dedupCheck(input: DedupCheck, actor: ReadActor): Promise<Result<DedupVerdict[]>> {
		return signedIn("dedup", actor, async (a) => ok(await dedupVerdicts(a, input)));
	}

	/** Declare an upload and receive a scoped, short-lived signed-URL ticket. */
	static uploadInit(input: UploadInit, actor: ReadActor): Promise<Result<UploadTicket>> {
		return signedIn("upload-init", actor, async (a) => toResult(await initUpload(a, input)));
	}

	/** The bytes landed: inspect, process and admit them. */
	static uploadComplete(input: UploadComplete, actor: ReadActor): Promise<Result<AssetItem>> {
		return signedIn("upload-complete", actor, async (a) => toResult(await completeUpload(a, input)));
	}

	/** Store a web link as a first-class asset. */
	static attachLink(input: LinkAttach, actor: ReadActor): Promise<Result<AssetItem>> {
		return signedIn("link", actor, async (a) => toResult(await attachLink(a, input)));
	}

	// #endregion

	// #region Mutations

	/** Create a folder in the acting library. */
	static createFolder(input: CreateFolder, actor: ReadActor): Promise<Result<AssetFolder>> {
		return signedIn("folder", actor, async (a) => toResult(await createFolder(a, input)));
	}

	/** Rename an asset (the extension is kept). */
	static rename(input: RenameAsset, actor: ReadActor): Promise<Result<AssetItem>> {
		return signedIn("rename", actor, async (a) => toResult(await renameAsset(a, input)));
	}

	/** Move assets within the acting library. */
	static move(input: MoveAssets, actor: ReadActor): Promise<Result<{ moved: number }>> {
		return signedIn("move", actor, async (a) => toResult(await moveAssets(a, input)));
	}

	/** Soft-delete assets, closing their share links. */
	static remove(input: DeleteAssets, actor: ReadActor): Promise<Result<{ removed: number }>> {
		return signedIn("delete", actor, async (a) => toResult(await removeAssets(a, input)));
	}

	/** Change the privacy scope of assets and folders in one call. */
	static setVisibility(input: SetVisibility, actor: ReadActor): Promise<Result<AssetItem[]>> {
		return signedIn("visibility", actor, async (a) => toResult(await setVisibility(a, input)));
	}

	// #endregion

	// #region Sharing

	/** Mint a read-only link over one asset or folder the caller owns. */
	static createShare(input: CreateShare, actor: ReadActor): Promise<Result<ShareLink>> {
		return signedIn("share-create", actor, async (a) => toResult(await createShare(a, input)));
	}

	/** Revoke a link — the same answer whether it existed, was someone else's, or was already closed. */
	static revokeShare(input: RevokeShare, actor: ReadActor): Promise<Result<{ revoked: boolean }>> {
		return signedIn("share-revoke", actor, async (a) => toResult(await revokeShare(a, input)));
	}

	/**
	 * Resolve a slug for its recipient. Deliberately session-less: a share link is handed to someone
	 * with no account, and a signed-in visitor must not resolve a link a signed-out one cannot. Every
	 * dead state answers `not_found`.
	 */
	static resolveShare(slug: string): Promise<Result<ShareResolution>> {
		return anyone("share-resolve", async () => ok(await resolveShareSlug(slug)));
	}

	// #endregion

	// #region Downloads + objects

	/** Whether the acting viewer already holds a copy. */
	static downloadGuard(assetId: string, actor: ReadActor): Promise<Result<DownloadGuard>> {
		return signedIn("download-guard", actor, async (a) => toResult(await readDownloadGuard(a, assetId)));
	}

	/**
	 * Append a download to the ledger — for a signed-in reader of the file, or for anyone holding a live
	 * share link that reaches it (counted against the link's limit in the same statement).
	 */
	static recordDownload(
		params: { assetId: string; deviceFingerprint: string | null; via: DownloadVia; shareSlug?: string | null },
		actor: ReadActor,
	): Promise<Result<DownloadEvent>> {
		return anyone("download-record", async () => toResult(await recordDownload(actor, params)));
	}

	/** A slice of the download ledger the viewer may read. */
	static history(
		params: { assetId?: string; actorId?: string; cursor?: string | null; limit?: number },
		actor: ReadActor,
	): Promise<Result<DownloadHistoryPage>> {
		return signedIn("history", actor, async (a) => ok(await readHistory(a, params)));
	}

	/**
	 * Where to send a caller asking for an asset's bytes — a public object's stable address or a fresh
	 * short-lived signed URL — when they may read it. The private-object route's one decision; every
	 * refusal is the same 404, so the route cannot be used to learn that a file exists.
	 */
	static objectUrl(
		id: string,
		opts: { tier?: FileObjectTier | null; share?: string | null; download?: boolean },
		actor: ReadActor,
	): Promise<Result<{ url: string; private: boolean }>> {
		return anyone("object", async () => {
			const target = await objectUrlFor(actor, id, opts);
			return target ? ok(target) : fail(404, { message: "Not found." }) as Result<{ url: string; private: boolean }>;
		});
	}

	// #endregion
}
