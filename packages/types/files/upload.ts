import { z } from "zod";
import { AssetOwnerType, AssetVisibility } from "./assets.ts";
import { ContentFingerprintSchema, DedupVerdictSchema } from "./dedup.ts";
import { AssetMetadataSchema } from "./metadata.ts";
import { StorageBucket } from "./storage.ts";

/**
 * files.upload — the Zod SSOT for putting something INTO the asset hub, and for every mutation over
 * what is already there.
 *
 * The upload is a three-step handshake, not a single multipart POST: **init** declares what is coming
 * ({@link UploadInitSchema}), the server answers with a scoped, short-lived **ticket**
 * ({@link UploadTicketSchema}) the browser uploads directly against, and **complete**
 * ({@link UploadCompleteSchema}) hands the result back so the row can be finalised. Bytes never
 * transit an application route — a 500 MB file streamed through a Deno handler occupies a request
 * worker for minutes and buys nothing, and the signed URL is what lets the quota, dedup and MIME
 * checks all happen BEFORE a person waits.
 *
 * The three steps map onto `files.file_status`: init writes a `pending_upload` row, the object lands
 * in `quarantine` for `scanning`, and only a clean scan promotes it to `uploaded`. So a row exists
 * from the first moment, and an abandoned upload is a visible, sweepable `pending_upload` rather than
 * an orphaned object nobody has a record of.
 *
 * Only enum/array/string/number/boolean primitives are used so the module stays stable across Zod
 * majors.
 */

// #region Shared field shapes

/** An asset id, as every mutation below addresses one. */
const assetId = z.string().min(1).max(120);
/** A folder id. `null` means the library root, which is a real destination and not "unset". */
const folderId = z.string().max(120).nullable();
/** How many ids one bulk mutation may carry — a bound, so a malformed client cannot ask for the world. */
const BULK_MAX = 200;

// #endregion

// #region Upload handshake

/**
 * Step 1 — declare the incoming file.
 *
 * `fingerprint` is nullable because a browser in an insecure context has no `crypto.subtle` and simply
 * cannot compute one. That is a degraded experience (no duplicate prompt), never a blocked upload, so
 * the absence is modelled rather than rejected.
 */
export const UploadInitSchema = z.object({
	name: z.string().min(1).max(200),
	/** The browser's reported MIME type. Advisory only — the server re-sniffs during the scan. */
	mimeType: z.string().min(1).max(160),
	sizeBytes: z.number().int().min(0),
	fingerprint: ContentFingerprintSchema.nullable(),
	folderId,
	ownerType: AssetOwnerType,
	/** The owning principal — a user id, or a team/business/organisation id. */
	ownerId: z.string().min(1).max(80),
	visibility: AssetVisibility,
});
export type UploadInit = z.infer<typeof UploadInitSchema>;

/**
 * Step 2 — the server's scoped answer.
 *
 * `signedUrl` is short-lived and single-object by construction; it authorises writing exactly this
 * `path` in exactly this `bucket` and expires. `headers` are the ones the PUT must replay verbatim
 * (content type, checksum), returned as data so the client never hand-assembles a signature.
 *
 * `dedup` rides along on the ticket rather than requiring a separate round trip, because the answer is
 * already known by the time the fingerprint has been checked — and a duplicate prompt is only useful
 * if it arrives BEFORE the bytes start moving.
 */
export const UploadTicketSchema = z.object({
	/** The `pending_upload` row minted by init — the handle every later step addresses. */
	assetId,
	bucket: StorageBucket,
	/** Bucket-relative object path; its first segment is the RLS anchor (see `./storage.ts`). */
	path: z.string().min(1).max(1024),
	signedUrl: z.string().min(1).max(2000),
	/** ISO expiry of the signed URL. A stale ticket is re-requested, never retried. */
	expiresAt: z.string(),
	/** Headers the PUT must send verbatim. */
	headers: z.record(z.string().max(80), z.string().max(600)),
	dedup: DedupVerdictSchema,
});
export type UploadTicket = z.infer<typeof UploadTicketSchema>;

/**
 * Step 3 — the object landed. `etag` is the storage provider's receipt; `null` when it returned none.
 *
 * `metadata` arrives here rather than at init because extraction reads the file's BYTES, and at init
 * there are none: the browser decodes dimensions, a poster frame, a waveform or a page count while the
 * PUT is in flight and hands the result over once both have finished. It is optional so every caller
 * that predates extraction stays valid, and nullable so a client that TRIED and could not read the
 * file says so explicitly — an absent field and a null one are the same row to a reader that only
 * checks for truthiness, and they are not the same fact.
 */
export const UploadCompleteSchema = z.object({
	assetId,
	etag: z.string().max(120).nullable(),
	metadata: AssetMetadataSchema.nullable().optional(),
});
export type UploadComplete = z.infer<typeof UploadCompleteSchema>;

// #endregion

// #region Link attachment

/**
 * `https:` only, and anchored at both ends.
 *
 * `http:` is refused outright: an ingested link is fetched server-side for its title and favicon, and
 * fetching over plaintext lets anyone on the path choose what the platform stores and re-hosts.
 */
const HTTPS_URL = /^https:\/\/[^\s/$.?#][^\s]*$/i;

/**
 * Store a web link as a first-class asset.
 *
 * The regex is a CHEAP GATE, not the security boundary. The server must still resolve the host and
 * refuse loopback, link-local and private ranges before it fetches anything — `https://127.0.0.1/…`
 * and `https://metadata.internal/…` both satisfy this pattern, and an unguarded ingest fetch is a
 * textbook SSRF into the platform's own network.
 */
export const LinkAttachSchema = z.object({
	url: z.string().min(1).max(2000).regex(
		HTTPS_URL,
		"Only https:// links can be attached.",
	),
	folderId,
	ownerType: AssetOwnerType,
	ownerId: z.string().min(1).max(80),
});
export type LinkAttach = z.infer<typeof LinkAttachSchema>;

// #endregion

// #region Asset mutations

/** Rename one asset. The extension is preserved server-side; a person edits the name, not the type. */
export const RenameAssetSchema = z.object({
	assetId,
	name: z.string().min(1).max(200),
});
export type RenameAsset = z.infer<typeof RenameAssetSchema>;

/** Move assets into a folder. `targetFolderId: null` moves them to the library root. */
export const MoveAssetsSchema = z.object({
	assetIds: z.array(assetId).min(1).max(BULK_MAX),
	targetFolderId: folderId,
});
export type MoveAssets = z.infer<typeof MoveAssetsSchema>;

/**
 * Delete assets.
 *
 * Nothing is hard-deleted (root CLAUDE.md §5) — this stamps `files.items.deleted_at`, so a deletion is
 * recoverable and a share link that pointed at the asset stops resolving rather than 500ing.
 */
export const DeleteAssetsSchema = z.object({
	assetIds: z.array(assetId).min(1).max(BULK_MAX),
});
export type DeleteAssets = z.infer<typeof DeleteAssetsSchema>;

/**
 * Change the privacy scope of assets and/or folders.
 *
 * Both collections are accepted in one payload because the control that raises them is one control —
 * a person selecting a mixed set in the grid expects one answer, not two requests with a window where
 * half of their selection is public and half is not.
 */
export const SetVisibilitySchema = z.object({
	assetIds: z.array(assetId).max(BULK_MAX).default([]),
	folderIds: z.array(z.string().min(1).max(120)).max(BULK_MAX).default([]),
	visibility: AssetVisibility,
}).refine(
	(v) => v.assetIds.length + v.folderIds.length > 0,
	{ message: "Select at least one asset or folder." },
);
export type SetVisibility = z.infer<typeof SetVisibilitySchema>;

/** Create a folder. `parentId: null` creates it at the library root. */
export const CreateFolderSchema = z.object({
	name: z.string().min(1).max(200),
	parentId: folderId,
	ownerType: AssetOwnerType,
	ownerId: z.string().min(1).max(80),
	/** Omitted inherits the parent's scope, which is the only non-surprising default. */
	visibility: AssetVisibility.optional(),
});
export type CreateFolder = z.infer<typeof CreateFolderSchema>;

// #endregion
