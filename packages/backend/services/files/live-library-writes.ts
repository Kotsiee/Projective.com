import type { SupabaseClient } from "supabaseClient";
import type {
	AssetFolder,
	AssetItem,
	CopyAssets,
	CreateFolder,
	CreateShare,
	DeleteAssets,
	DownloadEvent,
	DownloadVia,
	LinkAttach,
	MoveAssets,
	RenameAsset,
	RenameFolder,
	RevokeShare,
	SetFolderColor,
	SetVisibility,
	ShareLink,
} from "@projective/types/files";
import { linkStorageAddress } from "@projective/types/files";
import { copyObject, removeObjects } from "../../core/storage-signed.ts";
import { getServiceClient, getUserClient } from "../../core/supabase.ts";
import { clamp } from "../../core/text.ts";
import type { ReadActor } from "../read-actor.ts";
import {
	FOLDER_COLUMNS,
	type FolderRow,
	fmtDateTime,
	ITEM_COLUMNS,
	type ItemRow,
	MANAGED_SOURCES,
	toAssetFolder,
} from "./asset-row.ts";
import { canFileInto, type FilesOwner, readAsset } from "./live-library.ts";
import { copyName, movedSubtree, subtreeOf } from "./library-tree.ts";
import { resolveLinkPreview } from "./link-scan.ts";
import { destinationFor } from "./live-uploads.ts";

/**
 * live-library-writes — every mutation over what the `/files` hub already holds, live, under the
 * caller's own session.
 *
 * The `files.items` / `files.folders` policies are the gate: a row is written only by the person who
 * created it, and only into a library they belong to (`files.fn_owns_library`). What this module adds
 * is the RULES a row policy cannot state — a new folder inherits its parent's privacy, a rename keeps
 * the extension, a move stays inside one library, a delete is a soft delete that also closes the
 * asset's share links, a mounted row is never moved, deleted or re-shared here (it mirrors its
 * provider, so `canManage` is false on it everywhere) — and the refusals in words. A copy is the one
 * write that leaves the caller's session for its files: see {@link copyAssets}.
 *
 * `files.items` INSERT never uses `RETURNING`: its SELECT policy is `files.fn_can_read(id)`, a stable
 * lookup that cannot see a row inserted by the same statement, so a returning insert would be refused
 * as a policy violation. Every insert here is read back by id instead.
 */

type Actor = ReadActor & { accessToken: string };
type Result<T> = { ok: true; data: T; status?: number; message?: string } | {
	ok: false;
	status: number;
	message: string;
	errors?: Record<string, string>;
};

/** The one sentence an owner request outside the caller's libraries answers with. */
const DENIED_OWNER = "You can't add files to that library.";
const NOTHING_MOVED = "Nothing could be moved there.";
/** How many ids one share-link close names: a whole folder's files would not fit one request URL. */
const SHARE_REVOKE_CHUNK = 200;

function filesDb(actor: Actor): SupabaseClient {
	return getUserClient(actor.accessToken).schema("files") as unknown as SupabaseClient;
}

/** The owner columns a new row carries for a library. */
function ownerColumns(actor: Actor, owner: FilesOwner) {
	return {
		owner_user_id: actor.userId,
		owner_type: owner.ownerType,
		owner_entity_id: owner.ownerType === "user" ? null : owner.ownerId,
	};
}

// #region Folders

/**
 * Create a folder in a library the caller holds. An omitted visibility INHERITS the parent's — the only
 * non-surprising default — and a sibling of the same name is refused, because the hub addresses a
 * folder by its name and two with one name would make an address ambiguous.
 */
export async function createFolder(actor: Actor, input: CreateFolder): Promise<Result<AssetFolder>> {
	const owner: FilesOwner = { ownerType: input.ownerType, ownerId: input.ownerId };
	if (!(await canFileInto(actor, owner))) return { ok: false, status: 403, message: DENIED_OWNER };
	const name = input.name.trim().replace(/[\\/]+/g, "-");
	if (!name) return { ok: false, status: 422, message: "Name the folder.", errors: { name: "required" } };

	const db = filesDb(actor);
	let parent: FolderRow | null = null;
	if (input.parentId) {
		const found = await db.from("folders").select(FOLDER_COLUMNS)
			.eq("id", input.parentId).eq("source", "supabase").is("deleted_at", null).maybeSingle();
		if (found.error && found.error.code !== "22P02") throw new Error(`files.folders read failed: ${found.error.message}`);
		parent = found.data as unknown as FolderRow | null;
		if (
			!parent ||
			parent.owner_type !== owner.ownerType ||
			(parent.owner_entity_id ?? parent.owner_user_id) !== owner.ownerId
		) {
			return { ok: false, status: 404, message: "That folder can't hold new folders." };
		}
	}

	const siblings = await (input.parentId
		? db.from("folders").select("id, name").eq("parent_folder_id", input.parentId)
		: db.from("folders").select("id, name").is("parent_folder_id", null).eq("owner_type", owner.ownerType)
			.eq(owner.ownerType === "user" ? "owner_user_id" : "owner_entity_id", owner.ownerId))
		.is("deleted_at", null);
	if (siblings.error) throw new Error(`files.folders read failed: ${siblings.error.message}`);
	const lower = name.toLowerCase();
	if (((siblings.data ?? []) as Array<{ name: string }>).some((f) => (f.name ?? "").toLowerCase() === lower)) {
		return { ok: false, status: 409, message: "There's already a folder with that name here.", errors: { name: "taken" } };
	}

	const { data, error } = await db.from("folders").insert({
		...ownerColumns(actor, owner),
		parent_folder_id: parent?.id ?? null,
		name,
		visibility: input.visibility ?? parent?.visibility ?? "private",
		color: input.color ?? null,
		path: parent ? [...(parent.path ?? []), parent.name ?? ""] : [],
	}).select(FOLDER_COLUMNS).single();
	if (error) {
		if (error.code === "42501") return { ok: false, status: 403, message: DENIED_OWNER };
		throw new Error(`files.folders insert failed: ${error.message}`);
	}
	return {
		ok: true,
		status: 201,
		message: "Folder created.",
		data: toAssetFolder(data as unknown as FolderRow, { itemCount: 0, sizeBytes: 0 }, {
			viewerId: actor.userId,
			shareSlug: null,
		}),
	};
}

/**
 * Rename a folder. Parent-first, one row at a time, for the reason a move is: every folder beneath it
 * carries this name in its `path`, and the guard checks each `path` against its parent's. A sibling of
 * the same name is refused, because the hub addresses a folder by its name.
 */
export async function renameFolder(actor: Actor, input: RenameFolder): Promise<Result<{ name: string }>> {
	const name = input.name.trim().replace(/[\\/]+/g, "-");
	if (!name) return { ok: false, status: 422, message: "Name the folder.", errors: { name: "required" } };
	const found = await foldersOf(actor, [input.folderId]);
	if (!found) return { ok: false, status: 404, message: "That folder can't be renamed." };
	const { chosen: [folder], library } = found;
	const subtree = new Set(subtreeOf(library, folder.id));
	if (library.some((f) => subtree.has(f.id) && f.owner_user_id !== actor.userId)) {
		return { ok: false, status: 403, message: "Someone else's folder is inside that one." };
	}
	const lower = name.toLowerCase();
	if (
		library.some((f) =>
			f.id !== folder.id && f.parent_folder_id === folder.parent_folder_id &&
			(f.name ?? "").toLowerCase() === lower
		)
	) {
		return { ok: false, status: 409, message: "There's already a folder with that name here.", errors: { name: "taken" } };
	}

	const renamed = library.map((f) => (f.id === folder.id ? { ...f, name } : f));
	const parent = renamed.find((f) => f.id === folder.parent_folder_id) ?? null;
	const [, ...below] = movedSubtree(renamed, folder.id, parent);
	const db = filesDb(actor);
	for (const row of [{ id: folder.id, patch: { name } as Record<string, unknown> }, ...below]) {
		const { error } = await db.from("folders").update(row.patch).eq("id", row.id);
		if (error?.code === "42501") return { ok: false, status: 403, message: "You can't rename this folder." };
		if (error) throw new Error(`files.folders update failed: ${error.message}`);
	}
	return { ok: true, data: { name }, message: "Renamed." };
}

// #endregion

// #region Assets

/** The extension a filename ends in, lower-cased, or `""`. */
function extOf(name: string): string {
	return /\.([a-z0-9]{1,12})$/i.exec(name)?.[1]?.toLowerCase() ?? "";
}

/** Rename an asset. The extension is kept — a person edits the name, not the type. */
export async function renameAsset(actor: Actor, input: RenameAsset): Promise<Result<AssetItem>> {
	const current = await readAsset(actor, input.assetId);
	if (!current) return { ok: false, status: 404, message: "No such file." };
	if (!current.canManage) return { ok: false, status: 403, message: "You can't rename this file." };
	let name = input.name.trim().replace(/[\\/]+/g, "-");
	if (!name) return { ok: false, status: 422, message: "Name the file.", errors: { name: "required" } };
	const ext = current.kind === "link" ? "" : current.ext;
	if (ext && extOf(name) !== ext) name = `${name}.${ext}`;

	const { error } = await filesDb(actor).from("items")
		.update({ display_name: clamp(name, 200) })
		.eq("id", input.assetId).eq("owner_user_id", actor.userId).is("deleted_at", null);
	if (error) {
		if (error.code === "42501") return { ok: false, status: 403, message: "You can't rename this file." };
		throw new Error(`files.items update failed: ${error.message}`);
	}
	const renamed = await readAsset(actor, input.assetId);
	return renamed ? { ok: true, data: renamed, message: "Renamed." } : { ok: false, status: 404, message: "No such file." };
}

/**
 * Star or unstar an asset. `files.items.starred` is its OWNER's shelf mark, so only the owner's own
 * row matches; anyone else's star is a 404, the same answer as a file they cannot see.
 */
export async function starAsset(actor: Actor, assetId: string, starred: boolean): Promise<Result<{ starred: boolean }>> {
	const { data, error } = await filesDb(actor).from("items")
		.update({ starred })
		.eq("id", assetId).eq("owner_user_id", actor.userId).is("deleted_at", null)
		.select("id");
	if (error) {
		if (error.code === "22P02") return { ok: false, status: 404, message: "No such file." };
		if (error.code === "42501") return { ok: false, status: 403, message: "You can't star this file." };
		throw new Error(`files.items star failed: ${error.message}`);
	}
	if ((data ?? []).length === 0) return { ok: false, status: 404, message: "Only a file's owner can star it." };
	return { ok: true, data: { starred }, message: starred ? "Starred." : "Unstarred." };
}

/**
 * The live native folder a write lands in, in a library the caller holds. `null` is the root;
 * `undefined` is a folder they cannot file into.
 */
async function targetFolder(actor: Actor, id: string | null): Promise<FolderRow | null | undefined> {
	if (!id) return null;
	const found = await filesDb(actor).from("folders").select(FOLDER_COLUMNS)
		.eq("id", id).eq("source", "supabase").is("deleted_at", null).maybeSingle();
	if (found.error && found.error.code !== "22P02") {
		throw new Error(`files.folders read failed: ${found.error.message}`);
	}
	const target = found.data as unknown as FolderRow | null;
	if (!target) return undefined;
	const owner = {
		ownerType: target.owner_type as FilesOwner["ownerType"],
		ownerId: target.owner_entity_id ?? target.owner_user_id,
	};
	return (await canFileInto(actor, owner)) ? target : undefined;
}

/**
 * Move assets into a folder of the SAME library (`null` = the acting library's root). The library is
 * the target folder's own, so a console drive moves within itself whatever context the caller acts in;
 * it must still be one the caller holds. Reports the count that actually moved rather than failing the
 * batch: a mixed selection with one read-only mount should move the rest.
 */
export async function moveAssets(actor: Actor, input: MoveAssets): Promise<Result<{ moved: number }>> {
	const assetIds = input.assetIds ?? [];
	const folderIds = input.folderIds ?? [];
	const db = filesDb(actor);
	const target = await targetFolder(actor, input.targetFolderId);
	if (target === undefined) return { ok: false, status: 404, message: "That folder isn't in this library." };

	let moved = 0;
	if (assetIds.length > 0) {
		let q = db.from("items").update({ folder_id: target?.id ?? null })
			.in("id", assetIds)
			.in("source", MANAGED_SOURCES)
			.eq("owner_user_id", actor.userId)
			.is("deleted_at", null);
		// A named folder keeps the move inside its library; the root is each file's own, in any library.
		if (target) {
			q = q.eq("owner_type", target.owner_type ?? "");
			q = target.owner_entity_id
				? q.eq("owner_entity_id", target.owner_entity_id)
				: q.is("owner_entity_id", null);
		}
		const { data, error } = await q.select("id");
		if (error) {
			if (error.code === "22P02") return { ok: false, status: 404, message: NOTHING_MOVED };
			if (error.code === "42501") return { ok: false, status: 403, message: NOTHING_MOVED };
			throw new Error(`files.items update failed: ${error.message}`);
		}
		moved += (data ?? []).length;
	}
	if (folderIds.length > 0) {
		const folders = await moveFolders(actor, folderIds, target);
		if (!folders.ok) return folders;
		moved += folders.data;
	}
	if (moved === 0) return { ok: false, status: 403, message: NOTHING_MOVED };
	const noun = folderIds.length > 0 ? "item" : "file";
	return { ok: true, data: { moved }, message: `Moved ${moved} ${noun}${moved === 1 ? "" : "s"}.` };
}

/** How many files one paste copies: each is a storage round trip inside one request. */
const COPY_MAX = 200;

const NOTHING_COPIED = "Those could not be copied.";

/** A stored file's row, as a copy reads it: the caller's own, finished, in the library. */
function copyable(db: SupabaseClient, actor: Actor) {
	return db.from("items").select(ITEM_COLUMNS)
		.in("source", MANAGED_SOURCES)
		.eq("owner_user_id", actor.userId)
		.eq("status", "uploaded")
		.eq("purpose", "library")
		.is("deleted_at", null);
}

/**
 * One file's copy: its bytes first, then its row, so a failed row leaves no row without an object and
 * its bytes can be taken back. Returns whether it landed, or `"quota"` when the allowance refused it.
 *
 * The row is the service role's write, as a finished upload's is: only the server may say `uploaded`,
 * and the bytes it says it about were already scanned. Its caller has read the source under their own
 * session. What the source was shared as is not copied: a copy starts private with no share link.
 */
async function copyItem(
	actor: Actor,
	row: ItemRow,
	folderId: string | null,
	name: string,
): Promise<boolean | "quota"> {
	const id = crypto.randomUUID();
	const owner: FilesOwner = {
		ownerType: row.owner_type as FilesOwner["ownerType"],
		ownerId: row.owner_entity_id ?? row.owner_user_id,
	};
	const isLink = row.source === "link";
	const place = isLink ? null : destinationFor(owner, actor.userId, id, row.storage_path.split("/").at(-1) ?? id);
	if (place && !(await copyObject(row.bucket_id, row.storage_path, place.bucket, place.path))) return false;
	const { error } = await getServiceClient().schema("files").from("items").insert({
		id,
		owner_user_id: actor.userId,
		owner_type: row.owner_type,
		owner_entity_id: row.owner_entity_id,
		folder_id: folderId,
		...(place ? { bucket_id: place.bucket, storage_path: place.path } : linkStorageAddress(id)),
		display_name: clamp(name, 200),
		original_name: row.original_name,
		mime_type: row.mime_type,
		size_bytes: row.size_bytes,
		category: row.category,
		metadata: row.metadata,
		source: row.source,
		status: "uploaded",
		visibility: "private",
		content_hash: row.content_hash,
		hash_algo: row.content_hash ? (row.hash_sampled ? "sampled-sha-256" : "sha-256") : null,
		hash_sampled: row.hash_sampled,
		link_url: row.link_url,
		link_domain: row.link_domain,
		link_title: row.link_title,
		link_description: row.link_description,
		link_favicon_url: row.link_favicon_url,
		link_image_url: row.link_image_url,
		link_scan_status: row.link_scan_status,
		link_scanned_at: row.link_scanned_at,
	});
	if (!error) return true;
	if (place) await removeObjects(place.bucket, [place.path]);
	if (error.code === "23514") return "quota";
	throw new Error(`files.items insert failed: ${error.message}`);
}

/**
 * Copy assets and folders into a folder of the same library (`null` = each one's own library root),
 * a folder with its subtree. What the viewer owns is copied, as a move takes what they own; a folder's
 * other members' files stay behind. A name already taken at the destination becomes "name (copy)".
 *
 * The storage quota is the database's: the insert's trigger refuses what will not fit, and the copies
 * made so far stand, because each is a complete file. An archived library's guard does not run for the
 * service role, so it is asked here.
 */
export async function copyAssets(actor: Actor, input: CopyAssets): Promise<Result<{ copied: number }>> {
	const assetIds = input.assetIds ?? [];
	const folderIds = input.folderIds ?? [];
	const db = filesDb(actor);
	const target = await targetFolder(actor, input.targetFolderId);
	if (target === undefined) return { ok: false, status: 404, message: "That folder isn't in this library." };
	const inLibrary = (row: Pick<ItemRow, "owner_type" | "owner_entity_id">) =>
		!target || (row.owner_type === target.owner_type && row.owner_entity_id === target.owner_entity_id);

	// #region Folders, parent-first, each one's new id held for its children and files
	const newIds = new Map<string, string>();
	const folderRows: Array<Record<string, unknown>> = [];
	if (folderIds.length > 0) {
		const found = await foldersOf(actor, folderIds);
		if (!found) return { ok: false, status: 404, message: "That folder isn't in this library." };
		const { chosen, library } = found;
		if (target && !library.some((f) => f.id === target.id)) {
			return { ok: false, status: 404, message: "That folder isn't in this library." };
		}
		const parentId = target?.id ?? null;
		const taken = new Set(
			library.filter((f) => f.parent_folder_id === parentId).map((f) => (f.name ?? "").toLowerCase()),
		);
		for (const folder of chosen) {
			if (target && subtreeOf(library, folder.id).includes(target.id)) {
				return { ok: false, status: 422, message: "A folder can't be copied inside itself." };
			}
			const name = copyName(folder.name ?? "", taken, false);
			taken.add(name.toLowerCase());
			const renamed = library.map((f) => (f.id === folder.id ? { ...f, name } : f));
			for (const row of movedSubtree(renamed, folder.id, target)) {
				const source = renamed.find((f) => f.id === row.id);
				if (!source) continue;
				const id = crypto.randomUUID();
				newIds.set(row.id, id);
				folderRows.push({
					id,
					...ownerColumns(actor, {
						ownerType: source.owner_type as FilesOwner["ownerType"],
						ownerId: source.owner_entity_id ?? actor.userId,
					}),
					parent_folder_id: row.id === folder.id ? parentId : newIds.get(source.parent_folder_id ?? ""),
					name: source.name,
					color: source.color,
					visibility: target?.visibility ?? "private",
					path: row.patch.path,
				});
			}
		}
	}
	// #endregion

	// #region Files: the ones named land in the target, a subtree's in its copied folder
	const named = assetIds.length > 0 ? await copyable(db, actor).in("id", assetIds) : { data: [], error: null };
	const nested = newIds.size > 0
		? await copyable(db, actor).in("folder_id", [...newIds.keys()])
		: { data: [], error: null };
	if (named.error?.code === "22P02") return { ok: false, status: 404, message: NOTHING_COPIED };
	if (named.error || nested.error) {
		throw new Error(`files.items read failed: ${(named.error ?? nested.error)?.message}`);
	}
	const direct = ((named.data ?? []) as unknown as ItemRow[]).filter(inLibrary);
	const within = (nested.data ?? []) as unknown as ItemRow[];
	if (direct.length + within.length + folderRows.length === 0) {
		return { ok: false, status: 403, message: NOTHING_COPIED };
	}
	if (direct.length + within.length > COPY_MAX || folderRows.length > COPY_MAX) {
		return { ok: false, status: 422, message: `A paste can copy up to ${COPY_MAX} files at a time.` };
	}
	// #endregion

	const entities = new Map(
		[...direct, ...within].filter((r) => r.owner_entity_id).map((r) => [r.owner_entity_id, r.owner_type]),
	);
	for (const [entity, ownerType] of entities) {
		const archived = await db.rpc("fn_library_archived", { p_owner_type: ownerType, p_owner_entity_id: entity });
		if (archived.error) throw new Error(`files.fn_library_archived failed: ${archived.error.message}`);
		if (archived.data === true) return { ok: false, status: 403, message: "An archived library is read-only." };
	}

	for (const row of folderRows) {
		const { error } = await db.from("folders").insert(row);
		if (error?.code === "42501") return { ok: false, status: 403, message: NOTHING_COPIED };
		if (error) throw new Error(`files.folders insert failed: ${error.message}`);
	}

	const first = direct[0];
	const held = first
		? await (target
			? db.from("items").select("display_name").eq("folder_id", target.id)
			: db.from("items").select("display_name").is("folder_id", null).match({
				owner_user_id: first.owner_user_id,
				owner_type: first.owner_type ?? "",
			})).is("deleted_at", null)
		: { data: [], error: null };
	if (held.error) throw new Error(`files.items read failed: ${held.error.message}`);
	const taken = new Set(
		((held.data ?? []) as Array<{ display_name: string | null }>).map((r) => (r.display_name ?? "").toLowerCase()),
	);

	let copied = folderIds.length;
	for (const [row, folder] of [
		...direct.map((r) => [r, target?.id ?? null] as const),
		...within.map((r) => [r, newIds.get(r.folder_id ?? "") ?? null] as const),
	]) {
		const inPlace = folder === (target?.id ?? null);
		const shown = row.display_name ?? "";
		const name = inPlace ? copyName(shown, taken, row.source !== "link") : shown;
		if (inPlace) taken.add(name.toLowerCase());
		const landed = await copyItem(actor, row, folder, name);
		if (landed === "quota") {
			return copied > 0
				? { ok: true, data: { copied }, message: `Copied ${copied}, then ran out of storage.` }
				: { ok: false, status: 403, message: "There isn't enough storage left for that." };
		}
		if (landed) copied += 1;
	}
	if (copied === 0) return { ok: false, status: 502, message: NOTHING_COPIED };
	return { ok: true, data: { copied }, message: `Copied ${copied} item${copied === 1 ? "" : "s"}.` };
}

/** Set or clear a folder's colour. Only its owner may, and a mounted folder mirrors its provider. */
export async function setFolderColor(
	actor: Actor,
	input: SetFolderColor,
): Promise<Result<{ color: string | null }>> {
	const { data, error } = await filesDb(actor).from("folders").update({ color: input.color })
		.eq("id", input.folderId).eq("source", "supabase").eq("owner_user_id", actor.userId)
		.is("deleted_at", null).select("id");
	if (error && error.code !== "22P02") {
		throw new Error(`files.folders update failed: ${error.message}`);
	}
	if ((data ?? []).length === 0) {
		return { ok: false, status: 404, message: "That folder can't be changed." };
	}
	return { ok: true, data: { color: input.color } };
}

/** The chosen live folders and the whole library they sit in, or `null` when they are not one library's. */
async function foldersOf(
	actor: Actor,
	folderIds: readonly string[],
): Promise<{ chosen: FolderRow[]; library: FolderRow[] } | null> {
	const db = filesDb(actor);
	const picked = await db.from("folders").select(FOLDER_COLUMNS)
		.in("id", [...folderIds]).eq("source", "supabase").is("deleted_at", null);
	if (picked.error?.code === "22P02") return null;
	if (picked.error) throw new Error(`files.folders read failed: ${picked.error.message}`);
	const chosen = (picked.data ?? []) as unknown as FolderRow[];
	const first = chosen[0];
	if (!first || chosen.length !== new Set(folderIds).size) return null;
	const entity = first.owner_entity_id;
	if (chosen.some((f) => f.owner_type !== first.owner_type || f.owner_entity_id !== entity)) {
		return null;
	}
	const q = db.from("folders").select(FOLDER_COLUMNS).eq("owner_type", first.owner_type ?? "")
		.eq("source", "supabase").is("deleted_at", null);
	const all =
		await (entity ? q.eq("owner_entity_id", entity) : q.eq("owner_user_id", first.owner_user_id));
	if (all.error) throw new Error(`files.folders read failed: ${all.error.message}`);
	return { chosen, library: (all.data ?? []) as unknown as FolderRow[] };
}

/**
 * Move folders, each with its subtree, under `target` (`null` for the library root). Parent-first, one
 * row at a time: the guard checks each `path` against its parent's, so one statement cannot do it. A
 * failure part-way leaves stale `path`s below the moved folder, which repeating the move repairs;
 * `path` is only a display trail, because a folder is resolved through its parent id.
 */
async function moveFolders(
	actor: Actor,
	folderIds: readonly string[],
	target: FolderRow | null,
): Promise<Result<number>> {
	const found = await foldersOf(actor, folderIds);
	if (!found) return { ok: false, status: 404, message: "That folder isn't in this library." };
	const { chosen, library } = found;
	if (target && !library.some((f) => f.id === target.id)) {
		return { ok: false, status: 404, message: "That folder isn't in this library." };
	}
	const parentId = target?.id ?? null;
	const moved = chosen.filter((f) => f.parent_folder_id !== parentId);
	for (const folder of moved) {
		const subtree = new Set(subtreeOf(library, folder.id));
		if (target && subtree.has(target.id)) {
			return { ok: false, status: 422, message: "A folder can't move inside itself." };
		}
		if (library.some((f) => subtree.has(f.id) && f.owner_user_id !== actor.userId)) {
			return { ok: false, status: 403, message: "Someone else's folder is inside that one." };
		}
		const lower = (folder.name ?? "").toLowerCase();
		if (
			library.some((f) => f.parent_folder_id === parentId && (f.name ?? "").toLowerCase() === lower)
		) {
			return { ok: false, status: 409, message: "There's already a folder with that name there." };
		}
	}
	const db = filesDb(actor);
	for (const folder of moved) {
		for (const row of movedSubtree(library, folder.id, target)) {
			const { error } = await db.from("folders").update(row.patch).eq("id", row.id);
			if (error?.code === "42501") return { ok: false, status: 403, message: NOTHING_MOVED };
			if (error) throw new Error(`files.folders update failed: ${error.message}`);
		}
	}
	return { ok: true, data: moved.length };
}

/**
 * Delete assets. Nothing is hard-deleted: `deleted_at` is stamped, so the deletion is recoverable and
 * the quota rollup drops the bytes; every share link over them is closed too, so a link does not
 * outlive its file as a broken download.
 */
export async function removeAssets(actor: Actor, input: DeleteAssets): Promise<Result<{ removed: number }>> {
	const db = filesDb(actor);
	const stamp = new Date().toISOString();
	const assetIds = input.assetIds ?? [];
	const folderIds = input.folderIds ?? [];
	let subtree: string[] = [];
	if (folderIds.length > 0) {
		const found = await foldersOf(actor, folderIds);
		if (!found) return { ok: false, status: 404, message: "That folder isn't in this library." };
		subtree = [...new Set(found.chosen.flatMap((f) => subtreeOf(found.library, f.id)))];
		const held = await db.from("items").select("owner_user_id").in("folder_id", subtree).is(
			"deleted_at",
			null,
		);
		if (held.error) throw new Error(`files.items read failed: ${held.error.message}`);
		const swept = new Set(subtree);
		const shared = found.library.some((f) => swept.has(f.id) && f.owner_user_id !== actor.userId) ||
			((held.data ?? []) as Array<{ owner_user_id: string }>).some((i) =>
				i.owner_user_id !== actor.userId
			);
		// Refused whole: a row policy would skip the other person's files and bury them in a deleted folder.
		if (shared) {
			return { ok: false, status: 403, message: "Someone else's work is in that folder." };
		}
	}

	const sweep = (column: "id" | "folder_id", values: readonly string[]) =>
		db.from("items").update({ deleted_at: stamp }).in(column, [...values])
			.in("source", MANAGED_SOURCES).eq("owner_user_id", actor.userId).is("deleted_at", null)
			.select("id");
	// The files go first: a failure then leaves a live, emptied folder, never a deleted one hiding them.
	const sweeps = await Promise.all([
		...(assetIds.length > 0 ? [sweep("id", assetIds)] : []),
		...(subtree.length > 0 ? [sweep("folder_id", subtree)] : []),
	]);
	const removed: string[] = [];
	for (const { data, error } of sweeps) {
		if (error?.code === "22P02") {
			return { ok: false, status: 404, message: "Nothing could be deleted." };
		}
		if (error?.code === "42501") {
			return { ok: false, status: 403, message: "Nothing could be deleted." };
		}
		if (error) throw new Error(`files.items update failed: ${error.message}`);
		removed.push(...((data ?? []) as Array<{ id: string }>).map((r) => r.id));
	}
	if (subtree.length > 0) {
		const { error } = await db.from("folders").update({ deleted_at: stamp }).in("id", subtree).is(
			"deleted_at",
			null,
		);
		if (error?.code === "42501") {
			return { ok: false, status: 403, message: "Nothing could be deleted." };
		}
		if (error) throw new Error(`files.folders update failed: ${error.message}`);
		await db.from("share_links").update({ revoked_at: stamp })
			.in("folder_id", subtree).eq("created_by", actor.userId).is("revoked_at", null);
	}
	if (removed.length + subtree.length === 0) {
		return { ok: false, status: 403, message: "Nothing could be deleted." };
	}
	for (let i = 0; i < removed.length; i += SHARE_REVOKE_CHUNK) {
		await db.from("share_links").update({ revoked_at: stamp })
			.in("item_id", removed.slice(i, i + SHARE_REVOKE_CHUNK))
			.eq("created_by", actor.userId).is("revoked_at", null);
	}
	const count = removed.length + folderIds.length;
	const noun = folderIds.length > 0 ? "item" : "file";
	return {
		ok: true,
		data: { removed: count },
		message: `Deleted ${count} ${noun}${count === 1 ? "" : "s"}.`,
	};
}

/**
 * Change the privacy scope of a mixed selection. Explicit, owner-only; elevation by attaching happens
 * elsewhere, so this is the only way a scope is ever lowered.
 */
export async function setVisibility(actor: Actor, input: SetVisibility): Promise<Result<AssetItem[]>> {
	const db = filesDb(actor);
	let touchedItems: string[] = [];
	if (input.assetIds.length > 0) {
		const res = await db.from("items").update({ visibility: input.visibility })
			.in("id", input.assetIds).in("source", MANAGED_SOURCES).eq("owner_user_id", actor.userId)
			.is("deleted_at", null).select("id");
		if (res.error?.code === "42501") return { ok: false, status: 403, message: "Nothing could be changed." };
		if (res.error && res.error.code !== "22P02") throw new Error(`files.items update failed: ${res.error.message}`);
		touchedItems = ((res.data ?? []) as Array<{ id: string }>).map((r) => r.id);
	}
	let touchedFolders = 0;
	if (input.folderIds.length > 0) {
		const res = await db.from("folders").update({ visibility: input.visibility })
			.in("id", input.folderIds).eq("source", "supabase").eq("owner_user_id", actor.userId)
			.is("deleted_at", null).select("id");
		if (res.error?.code === "42501") return { ok: false, status: 403, message: "Nothing could be changed." };
		if (res.error && res.error.code !== "22P02") throw new Error(`files.folders update failed: ${res.error.message}`);
		touchedFolders = (res.data ?? []).length;
	}
	if (touchedItems.length === 0 && touchedFolders === 0) {
		return { ok: false, status: 403, message: "Nothing could be changed." };
	}
	const items = (await Promise.all(touchedItems.map((id) => readAsset(actor, id)))).filter((it): it is AssetItem => !!it);
	return { ok: true, data: items, message: "Sharing updated." };
}

// #endregion

// #region Links

/**
 * Store a web link as a first-class asset in a library the caller holds.
 *
 * A link stores no bytes, so it takes a synthesised object address (`link` / its own id) that the
 * registry's one-row-per-object constraint accepts. The caller's session inserts it `pending`, bare
 * of everything the scan concluded; the scan's verdict, favicon, title and description are then
 * written by the service role (Decision #314), because a verdict a client could set would launder a
 * URL past the scan. Until that write lands the link reads `pending`, which every open routes
 * through `/exit`.
 */
export async function attachLink(actor: Actor, input: LinkAttach): Promise<Result<AssetItem>> {
	const owner: FilesOwner = { ownerType: input.ownerType, ownerId: input.ownerId };
	if (!(await canFileInto(actor, owner))) return { ok: false, status: 403, message: DENIED_OWNER };
	const preview = await resolveLinkPreview(input.url);
	if (!preview) {
		return {
			ok: false,
			status: 422,
			message: "That link could not be attached.",
			errors: { url: "Only public https:// links can be attached." },
		};
	}
	const db = filesDb(actor);
	if (input.folderId) {
		const target = await db.from("folders").select("id, owner_type, owner_user_id, owner_entity_id")
			.eq("id", input.folderId).eq("source", "supabase").is("deleted_at", null).maybeSingle();
		const t = target.data as { owner_type: string; owner_user_id: string; owner_entity_id: string | null } | null;
		if (!t || t.owner_type !== owner.ownerType || (t.owner_entity_id ?? t.owner_user_id) !== owner.ownerId) {
			return { ok: false, status: 404, message: "That folder isn't in this library." };
		}
	}
	const id = crypto.randomUUID();
	const { error } = await db.from("items").insert({
		id,
		...ownerColumns(actor, owner),
		folder_id: input.folderId ?? null,
		...linkStorageAddress(id),
		display_name: clamp(preview.title || preview.domain, 200),
		original_name: clamp(preview.url, 200),
		mime_type: "text/uri-list",
		size_bytes: 0,
		source: "link",
		status: "uploaded",
		visibility: "private",
		link_url: preview.url,
		link_domain: preview.domain,
		link_scan_status: "pending",
	});
	if (error) {
		if (error.code === "42501") return { ok: false, status: 403, message: DENIED_OWNER };
		throw new Error(`files.items insert failed: ${error.message}`);
	}
	const verdict = await getServiceClient().schema("files").from("items").update({
		link_title: preview.title,
		link_description: preview.description,
		link_favicon_url: preview.faviconUrl,
		link_image_url: preview.imageUrl ?? null,
		link_scan_status: preview.scanStatus,
		link_scanned_at: preview.scannedAt,
	}).eq("id", id).eq("source", "link").eq("owner_user_id", actor.userId)
		.eq("link_scan_status", "pending");
	if (verdict.error) {
		throw new Error(`files.items link verdict write failed: ${verdict.error.message}`);
	}
	const item = await readAsset(actor, id);
	return item ? { ok: true, status: 201, data: item, message: "Link saved." } : { ok: false, status: 503, message: "The link was saved but could not be read back." };
}

// #endregion

// #region Shares

/** A server-minted share slug: 24 random bytes, base64url — 192 bits, the credential itself. */
function mintSlug(): string {
	const bytes = crypto.getRandomValues(new Uint8Array(24));
	return btoa(String.fromCharCode(...bytes)).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

interface ShareRow {
	slug: string;
	item_id: string | null;
	folder_id: string | null;
	visibility: "private" | "link" | "public";
	expires_at: string | null;
	revoked_at: string | null;
	download_limit: number | null;
	download_count: number;
	created_at: string;
	created_by: string;
}

function toShareLink(row: ShareRow): ShareLink {
	return {
		slug: row.slug,
		itemId: row.item_id,
		folderId: row.folder_id,
		visibility: row.visibility,
		expiresAt: row.expires_at,
		revokedAt: row.revoked_at,
		downloadLimit: row.download_limit,
		downloadCount: row.download_count,
		createdAt: row.created_at,
		createdBy: row.created_by,
	};
}

/**
 * Mint a read-only link over exactly one asset or folder the caller owns. The policy refuses anything
 * else; that refusal answers "no such file", which is also true from the caller's side.
 */
export async function createShare(actor: Actor, input: CreateShare): Promise<Result<ShareLink>> {
	const expiresAt = input.expiresAt ? Date.parse(input.expiresAt) : null;
	if (expiresAt !== null && (!Number.isFinite(expiresAt) || expiresAt <= Date.now())) {
		return { ok: false, status: 422, message: "Choose an expiry in the future.", errors: { expiresAt: "past" } };
	}
	const { data, error } = await filesDb(actor).from("share_links").insert({
		slug: mintSlug(),
		item_id: input.itemId ?? null,
		folder_id: input.folderId ?? null,
		created_by: actor.userId,
		visibility: input.visibility,
		expires_at: expiresAt === null ? null : new Date(expiresAt).toISOString(),
		download_limit: input.downloadLimit ?? null,
	}).select("slug, item_id, folder_id, visibility, expires_at, revoked_at, download_limit, download_count, created_at, created_by")
		.single();
	if (error) {
		if (error.code === "42501" || error.code === "23503" || error.code === "22P02") {
			return { ok: false, status: 404, message: "No such file or folder." };
		}
		throw new Error(`files.share_links insert failed: ${error.message}`);
	}
	return { ok: true, status: 201, data: toShareLink(data as unknown as ShareRow), message: "Share link created." };
}

/**
 * Revoke a link. An unknown slug, someone else's and an already-closed one all answer the same
 * `{ revoked: false }` — a different answer would confirm the slug exists.
 */
export async function revokeShare(actor: Actor, input: RevokeShare): Promise<Result<{ revoked: boolean }>> {
	const { data, error } = await filesDb(actor).from("share_links")
		.update({ revoked_at: new Date().toISOString() })
		.eq("slug", input.slug).eq("created_by", actor.userId).is("revoked_at", null)
		.select("slug");
	if (error) throw new Error(`files.share_links update failed: ${error.message}`);
	const revoked = (data ?? []).length > 0;
	return { ok: true, data: { revoked }, message: revoked ? "Share link revoked." : "That link is already closed." };
}

// #endregion

// #region Download ledger

/**
 * Record one download, after deciding the caller may take it: through a live share link (the ledger
 * function checks the link reaches the file and is under its limit, in the same statement it counts
 * it), or through their own read of the file.
 */
export async function recordDownload(
	actor: ReadActor,
	params: { assetId: string; deviceFingerprint: string | null; via: DownloadVia; shareSlug?: string | null },
): Promise<Result<DownloadEvent>> {
	const slug = params.shareSlug ?? null;
	if (!slug) {
		if (!actor.userId || !actor.accessToken) return { ok: false, status: 401, message: "Sign in to download." };
		const readable = await readAsset(actor as Actor, params.assetId);
		if (!readable) return { ok: false, status: 404, message: "No such file." };
	}
	const { data, error } = await getServiceClient().schema("files").rpc("fn_record_download", {
		p_item_id: params.assetId,
		p_actor: actor.userId || null,
		p_device: params.deviceFingerprint,
		p_via: slug ? "share" : params.via,
		p_share_slug: slug,
	});
	if (error) {
		if (error.code === "PS404" || error.code === "PB404" || error.code === "22P02") {
			return { ok: false, status: 404, message: "That link is no longer available." };
		}
		throw new Error(`files.fn_record_download failed: ${error.message}`);
	}
	const row = data as {
		id: string;
		item_id: string;
		actor_user_id: string | null;
		device_fingerprint: string | null;
		via: DownloadVia;
		share_slug: string | null;
		downloaded_at: string;
	};
	const named = await getServiceClient().schema("files").from("items").select("display_name").eq("id", row.item_id).maybeSingle();
	return {
		ok: true,
		status: 201,
		data: {
			id: row.id,
			assetId: row.item_id,
			assetName: clamp((named.data as { display_name: string } | null)?.display_name, 200) || "A file",
			actorId: row.actor_user_id,
			actorHandle: null,
			via: row.via,
			shareSlug: row.share_slug,
			deviceFingerprint: row.device_fingerprint ? clamp(row.device_fingerprint, 120) : null,
			at: row.downloaded_at,
			dateLabel: clamp(fmtDateTime(Date.parse(row.downloaded_at)), 28),
		},
	};
}

// #endregion
