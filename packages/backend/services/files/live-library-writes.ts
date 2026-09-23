import type { SupabaseClient } from "supabaseClient";
import type {
	AssetFolder,
	AssetItem,
	CreateFolder,
	CreateShare,
	DeleteAssets,
	DownloadEvent,
	DownloadVia,
	LinkAttach,
	MoveAssets,
	RenameAsset,
	RevokeShare,
	SetVisibility,
	ShareLink,
} from "@projective/types/files";
import { getServiceClient, getUserClient } from "../../core/supabase.ts";
import { clamp } from "../../core/text.ts";
import type { ReadActor } from "../read-actor.ts";
import { FOLDER_COLUMNS, type FolderRow, fmtDateTime, toAssetFolder } from "./asset-row.ts";
import { type FilesOwner, mayFileInto, ownerOfActor, readAsset } from "./live-library.ts";
import { resolveLinkPreview } from "./link-scan.ts";

/**
 * live-library-writes — every mutation over what the `/files` hub already holds, live, under the
 * caller's own session.
 *
 * The `files.items` / `files.folders` policies are the gate: a row is written only by the person who
 * created it, and only into a library they belong to (`files.fn_owns_library`). What this module adds
 * is the RULES a row policy cannot state — a new folder inherits its parent's privacy, a rename keeps
 * the extension, a move stays inside one library, a delete is a soft delete that also closes the
 * asset's share links — and the refusals in words.
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

/** The one sentence an owner request outside the acting library answers with. */
const DENIED_OWNER = "You can't add files to that library.";

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
 * Create a folder in the acting library. An omitted visibility INHERITS the parent's — the only
 * non-surprising default — and a sibling of the same name is refused, because the hub addresses a
 * folder by its name and two with one name would make an address ambiguous.
 */
export async function createFolder(actor: Actor, input: CreateFolder): Promise<Result<AssetFolder>> {
	const owner: FilesOwner = { ownerType: input.ownerType, ownerId: input.ownerId };
	if (!mayFileInto(actor, owner)) return { ok: false, status: 403, message: DENIED_OWNER };
	const name = input.name.trim().replace(/[\\/]+/g, "-");
	if (!name) return { ok: false, status: 422, message: "Name the folder.", errors: { name: "required" } };

	const db = filesDb(actor);
	let parent: FolderRow | null = null;
	if (input.parentId) {
		const found = await db.from("folders").select(FOLDER_COLUMNS)
			.eq("id", input.parentId).is("deleted_at", null).maybeSingle();
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
	if (error) throw new Error(`files.items update failed: ${error.message}`);
	const renamed = await readAsset(actor, input.assetId);
	return renamed ? { ok: true, data: renamed, message: "Renamed." } : { ok: false, status: 404, message: "No such file." };
}

/**
 * Move assets into a folder of the SAME library (`null` = its root). Reports the count that actually
 * moved rather than failing the batch: a mixed selection with one read-only mount should move the rest.
 */
export async function moveAssets(actor: Actor, input: MoveAssets): Promise<Result<{ moved: number }>> {
	const owner = ownerOfActor(actor);
	const db = filesDb(actor);
	if (input.targetFolderId) {
		const target = await db.from("folders").select("id, owner_type, owner_user_id, owner_entity_id")
			.eq("id", input.targetFolderId).is("deleted_at", null).maybeSingle();
		if (target.error && target.error.code !== "22P02") throw new Error(`files.folders read failed: ${target.error.message}`);
		const t = target.data as { owner_type: string; owner_user_id: string; owner_entity_id: string | null } | null;
		if (!t || t.owner_type !== owner.ownerType || (t.owner_entity_id ?? t.owner_user_id) !== owner.ownerId) {
			return { ok: false, status: 404, message: "That folder isn't in this library." };
		}
	}
	let q = db.from("items").update({ folder_id: input.targetFolderId ?? null })
		.in("id", input.assetIds)
		.eq("owner_user_id", actor.userId)
		.eq("owner_type", owner.ownerType)
		.is("deleted_at", null);
	q = owner.ownerType === "user" ? q.is("owner_entity_id", null) : q.eq("owner_entity_id", owner.ownerId);
	const { data, error } = await q.select("id");
	if (error) {
		if (error.code === "22P02") return { ok: false, status: 404, message: "Nothing could be moved there." };
		throw new Error(`files.items update failed: ${error.message}`);
	}
	const moved = (data ?? []).length;
	if (moved === 0) return { ok: false, status: 403, message: "Nothing could be moved there." };
	return { ok: true, data: { moved }, message: `Moved ${moved} ${moved === 1 ? "file" : "files"}.` };
}

/**
 * Delete assets. Nothing is hard-deleted: `deleted_at` is stamped, so the deletion is recoverable and
 * the quota rollup drops the bytes; every share link over them is closed too, so a link does not
 * outlive its file as a broken download.
 */
export async function removeAssets(actor: Actor, input: DeleteAssets): Promise<Result<{ removed: number }>> {
	const db = filesDb(actor);
	const { data, error } = await db.from("items").update({ deleted_at: new Date().toISOString() })
		.in("id", input.assetIds).eq("owner_user_id", actor.userId).is("deleted_at", null).select("id");
	if (error) {
		if (error.code === "22P02") return { ok: false, status: 404, message: "Nothing could be deleted." };
		throw new Error(`files.items update failed: ${error.message}`);
	}
	const removed = ((data ?? []) as Array<{ id: string }>).map((r) => r.id);
	if (removed.length === 0) return { ok: false, status: 403, message: "Nothing could be deleted." };
	await db.from("share_links").update({ revoked_at: new Date().toISOString() })
		.in("item_id", removed).eq("created_by", actor.userId).is("revoked_at", null);
	return {
		ok: true,
		data: { removed: removed.length },
		message: `Deleted ${removed.length} ${removed.length === 1 ? "file" : "files"}.`,
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
			.in("id", input.assetIds).eq("owner_user_id", actor.userId).is("deleted_at", null).select("id");
		if (res.error && res.error.code !== "22P02") throw new Error(`files.items update failed: ${res.error.message}`);
		touchedItems = ((res.data ?? []) as Array<{ id: string }>).map((r) => r.id);
	}
	let touchedFolders = 0;
	if (input.folderIds.length > 0) {
		const res = await db.from("folders").update({ visibility: input.visibility })
			.in("id", input.folderIds).eq("owner_user_id", actor.userId).is("deleted_at", null).select("id");
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
 * Store a web link as a first-class asset in the acting library.
 *
 * A link stores no bytes, so it takes a synthesised object address (`link` / its own id) that the
 * registry's one-row-per-object constraint accepts. It is stored as never scanned (`pending`): no
 * reputation feed is configured, and a verdict nobody computed must not be asserted.
 */
export async function attachLink(actor: Actor, input: LinkAttach): Promise<Result<AssetItem>> {
	const owner: FilesOwner = { ownerType: input.ownerType, ownerId: input.ownerId };
	if (!mayFileInto(actor, owner)) return { ok: false, status: 403, message: DENIED_OWNER };
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
			.eq("id", input.folderId).is("deleted_at", null).maybeSingle();
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
		bucket_id: "link",
		storage_path: id,
		display_name: clamp(preview.title || preview.domain, 200),
		original_name: clamp(preview.url, 200),
		mime_type: "text/uri-list",
		size_bytes: 0,
		source: "link",
		status: "uploaded",
		visibility: "private",
		link_url: preview.url,
		link_domain: preview.domain,
		link_title: preview.title,
		link_description: preview.description,
		link_favicon_url: preview.faviconUrl,
		link_scan_status: preview.scanStatus,
		link_scanned_at: preview.scannedAt,
	});
	if (error) {
		if (error.code === "42501") return { ok: false, status: 403, message: DENIED_OWNER };
		throw new Error(`files.items insert failed: ${error.message}`);
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
