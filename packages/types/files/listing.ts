import { z } from "zod";
import { AssetCrumbSchema, AssetItemSchema, FileScope } from "./assets.ts";
import { AssetFolderSchema } from "./folders.ts";
import { StorageQuotaSchema } from "./quota.ts";

/**
 * files.listing — the page ENVELOPE a scope read answers with.
 *
 * It lives in its own module rather than beside {@link AssetListParamsSchema} in `./assets.ts` for a
 * structural reason: a listing is **folders and items together**, and `./folders.ts` already imports
 * `./assets.ts`. Declaring the envelope in `assets.ts` would mean importing `AssetFolderSchema` back
 * out of `folders.ts` and closing an import cycle — the TDZ crash class recorded in Decision #49, in a
 * module whose consumers build their corpus at import time. Nothing imports this module, so the edge
 * stays one-way by construction.
 *
 * **Folders and items arrive in one payload on purpose.** A hub view renders both in the same grid,
 * ordered by the same sort, and splitting them across two requests would let a folder rename land in
 * one response and not the other — a reader would see the same directory under two names.
 *
 * **The quota rides along on a `hub` read.** The storage meter is chrome on the same screen, and a
 * second round trip for it means the meter paints after the grid and jumps. It is `null` for every
 * other scope, because a project's attachments, a mounted drive and a share resolution are not metered
 * against the reader's allowance and drawing a meter there would assert otherwise.
 *
 * Like its siblings this is a READ projection, not a table row — the fat `FilesBackendService` derives
 * it deterministically while `FILES_BACKEND_LIVE` is off, and the live path (RLS-scoped `files.items` /
 * `files.folders`) slots in behind the same gate with no shape churn. Only enum/array/string/number/
 * boolean primitives are used so the module stays stable across Zod majors.
 */

// #region Page envelope

/** One page of a scope read — the folders and assets at a location, plus the trail that reached it. */
export const AssetListPageSchema = z.object({
	scope: FileScope,
	/**
	 * The scope's subject, echoed back: a project id, a conversation id, an owner id, a connection id
	 * or a share slug. `null` when the scope needs none.
	 */
	subjectId: z.string().max(120).nullable(),
	/** The folder that was listed; `null` at the scope root. */
	folderId: z.string().max(120).nullable(),
	/** The matched assets, already filtered, sorted and paged. */
	items: z.array(AssetItemSchema),
	/**
	 * The child folders at this location. NOT paged alongside `items` — a directory has orders of
	 * magnitude fewer subfolders than files, and paging them would hide a folder behind a "load more"
	 * that exists for the file list.
	 */
	folders: z.array(AssetFolderSchema),
	/** The breadcrumb trail to this location, root-first and already scope-correct. */
	crumbs: z.array(AssetCrumbSchema),
	hasMore: z.boolean(),
	nextCursor: z.string().max(120).nullable(),
	/** Total matched across all pages — drives the "N files" caption. */
	total: z.number().int().min(0),
	/** The acting viewer's id — the client renders identity from this, never from a cookie it read. */
	viewerId: z.string().max(80),
	/**
	 * Whether this whole location is read-only for the viewer.
	 *
	 * A LOCATION-level fact, distinct from the per-asset `canManage`: a mounted project channel and a
	 * connected drive are read-only in the hub as places, so the surface withholds the upload target and
	 * the new-folder control rather than offering them and refusing each attempt.
	 */
	readOnly: z.boolean(),
	/** The owner's storage allowance on a `hub` read; `null` for every other scope (see the note). */
	quota: StorageQuotaSchema.nullable(),
});
export type AssetListPage = z.infer<typeof AssetListPageSchema>;

// #endregion
