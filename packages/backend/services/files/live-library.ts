import type { SupabaseClient } from "supabaseClient";
import type {
	AssetCrumb,
	AssetFolder,
	AssetItem,
	AssetListPage,
	AssetListParams,
	AssetOwnerType,
	AssetTreeNode,
	DedupCheck,
	DedupVerdict,
	DownloadEvent,
	DownloadGuard,
	DownloadHistoryPage,
	FileSortDir,
	FileSortKey,
	ShareResolution,
	StorageQuota,
} from "@projective/types/files";
import { fileObjectHref, PLAN_STORAGE_MIB } from "@projective/types/files";
import type { PlanCode } from "@projective/types/finance";
import { getAnonClient, getServiceClient, getUserClient } from "../../core/supabase.ts";
import { isPublicBucket } from "../../core/storage-url.ts";
import { clamp } from "../../core/text.ts";
import type { ReadActor } from "../read-actor.ts";
import {
	type AssetContext,
	bytesOf,
	FOLDER_COLUMNS,
	folderTrail,
	type FolderRow,
	fmtDateTime,
	ITEM_COLUMNS,
	type ItemRow,
	toAssetFolder,
	toAssetItem,
} from "./asset-row.ts";

/**
 * live-library — the `/files` hub's reads, live against `files.*` under the caller's own session.
 *
 * RLS is the gate throughout: `files.fn_can_read` decides which assets a caller may see and the folder
 * policies which folders. What this module adds is the SHAPE — which library a read is about (the one
 * the acting context owns, never one named in a payload), the folder tree and its rollups, the
 * breadcrumb trail, the storage allowance and the viewer's own download and share facts.
 *
 * A library is read whole (bounded by {@link LIBRARY_WINDOW}) and filtered, sorted and paged in
 * memory. That is what makes a folder's subtree size and a location's breadcrumbs answerable without a
 * recursive query per row, and it is the honest trade at the size a personal or team library reaches;
 * the bound is stated rather than silent.
 */

type Actor = ReadActor & { accessToken: string };
type Result<T> = { ok: true; data: T } | { ok: false; status: number; message: string };

/** The most assets and folders one library read loads. */
const LIBRARY_WINDOW = 2000;
/** The page size when a caller does not ask for one, and the largest it may ask for. */
const DEFAULT_LIMIT = 60;
const MAX_LIMIT = 200;
/** The segment prefix a mounted engagement is addressed by inside the hub (`/files/mnt-prj-…`). */
export const MOUNT_PREFIX = "mnt-";

/**
 * The one `files.items.status` a read may present, match or share: the bytes are stored and
 * inspected. A link is written `uploaded` too, so this keeps every link.
 *
 * Everything else is a row with nothing behind it. A `pending_upload` whose browser went away before
 * the PUT finished never completes, a `quarantined` or `error` row's bytes were never kept, and a
 * `scanning` row is mid-inspection — listing any of them draws a card that opens nothing, and matching
 * one in dedup tells a person their re-upload is a duplicate of a file that does not exist, which
 * costs them the upload. The in-flight state belongs to the upload drawer that started it.
 */
const SETTLED = "uploaded";

// #region The acting library

/** Which library a hub read or write is about: the person's own, or the entity they act for. */
export interface FilesOwner {
	ownerType: AssetOwnerType;
	ownerId: string;
}

/**
 * The library the acting context owns. The session decides it — a payload's owner is at most a
 * REQUEST to act as that principal, honoured only when it is this one.
 */
export function ownerOfActor(actor: ReadActor): FilesOwner {
	return actor.contextType === "personal" || !actor.contextId
		? { ownerType: "user", ownerId: actor.userId }
		: { ownerType: actor.contextType, ownerId: actor.contextId };
}

/** Whether a requested owner is the acting library. */
export function isActingOwner(actor: ReadActor, requested: FilesOwner): boolean {
	const own = ownerOfActor(actor);
	return own.ownerType === requested.ownerType && own.ownerId === requested.ownerId;
}

/**
 * Whether the caller may file into a library: always their OWN personal library (whatever context
 * they are acting in — it is theirs either way), or the entity they are acting for. Any other owner in
 * a payload is refused; the items and folders policies refuse it too (`files.fn_owns_library`).
 */
export function mayFileInto(actor: ReadActor, requested: FilesOwner): boolean {
	if (requested.ownerType === "user") return requested.ownerId === actor.userId;
	return isActingOwner(actor, requested);
}

/**
 * The library a hub read is about: the person's own when the read names them, else the acting
 * context's. A read can therefore never name somebody else's library into view.
 */
function libraryFor(actor: ReadActor, subjectId: string | null | undefined): FilesOwner {
	return subjectId && subjectId === actor.userId ? { ownerType: "user", ownerId: actor.userId } : ownerOfActor(actor);
}

/**
 * The equality filters that narrow a `files.items`/`files.folders` query to one library, for the
 * builder's own `.match()`. A personal library is the person's own rows of the `user` kind (the write
 * policies keep a personal row's entity column empty); an entity library is keyed on the entity.
 */
function libraryMatch(owner: FilesOwner): Record<string, string> {
	return owner.ownerType === "user"
		? { owner_type: "user", owner_user_id: owner.ownerId }
		: { owner_type: owner.ownerType, owner_entity_id: owner.ownerId };
}

function filesDb(actor: Actor): SupabaseClient {
	return getUserClient(actor.accessToken).schema("files") as unknown as SupabaseClient;
}

// #endregion

// #region Library loads

interface Library {
	folders: FolderRow[];
	items: ItemRow[];
}

/** The whole library: its live folders and its live library-purpose assets. */
async function loadLibrary(actor: Actor, owner: FilesOwner): Promise<Library> {
	const db = filesDb(actor);
	const [folders, items] = await Promise.all([
		db.from("folders").select(FOLDER_COLUMNS).match(libraryMatch(owner))
			.is("deleted_at", null)
			.eq("source", "supabase")
			.order("name")
			.limit(LIBRARY_WINDOW),
		db.from("items").select(ITEM_COLUMNS).match(libraryMatch(owner))
			.is("deleted_at", null)
			// Renditions (a cropped avatar, a showcase slide) are copies the pipeline cut FROM a
			// library asset; listing them would show one picture three times.
			.eq("purpose", "library")
			.eq("status", SETTLED)
			.is("source_connection_id", null)
			.order("created_at", { ascending: false })
			.limit(LIBRARY_WINDOW),
	]);
	if (folders.error) throw new Error(`files.folders read failed: ${folders.error.message}`);
	if (items.error) throw new Error(`files.items read failed: ${items.error.message}`);
	return {
		folders: (folders.data ?? []) as unknown as FolderRow[],
		items: (items.data ?? []) as unknown as ItemRow[],
	};
}

/**
 * Walk path segments from the root: each is a child folder's id or (case-insensitively) its name,
 * which is what the hub's URLs carry. `undefined` when a segment names nothing.
 */
function walk(folders: readonly FolderRow[], segments: readonly string[]): FolderRow | null | undefined {
	let parent: string | null = null;
	let found: FolderRow | null = null;
	for (const segment of segments) {
		const lower = segment.toLowerCase();
		const match = folders.find((f) =>
			f.parent_folder_id === parent && (f.id === segment || (f.name ?? "").toLowerCase() === lower)
		);
		if (!match) return undefined;
		found = match;
		parent = match.id;
	}
	return found;
}

/** Direct item counts and subtree byte totals, per folder. */
function rollups(lib: Library): Map<string, { itemCount: number; sizeBytes: number }> {
	const out = new Map<string, { itemCount: number; sizeBytes: number }>();
	const parent = new Map(lib.folders.map((f) => [f.id, f.parent_folder_id]));
	for (const f of lib.folders) out.set(f.id, { itemCount: 0, sizeBytes: 0 });
	for (const item of lib.items) {
		if (!item.folder_id) continue;
		const direct = out.get(item.folder_id);
		if (direct) direct.itemCount += 1;
		const bytes = item.source === "supabase" ? bytesOf(item.size_bytes) : 0;
		let cursor: string | null | undefined = item.folder_id;
		let guard = 0;
		while (cursor && guard++ < 32) {
			const r = out.get(cursor);
			if (r) r.sizeBytes += bytes;
			cursor = parent.get(cursor);
		}
	}
	return out;
}

/** Every folder's trail, for items' `folderPath`. */
function trails(folders: readonly FolderRow[]): Map<string, string[]> {
	return new Map(folders.map((f) => [f.id, folderTrail(f)]));
}

/** The breadcrumb trail to a folder, root-first, as the hub addresses it. */
function crumbsTo(lib: Library, folder: FolderRow | null, rootLabel: string, base: string): AssetCrumb[] {
	const chain: FolderRow[] = [];
	const byId = new Map(lib.folders.map((f) => [f.id, f]));
	let cursor: FolderRow | null | undefined = folder;
	let guard = 0;
	while (cursor && guard++ < 24) {
		chain.unshift(cursor);
		cursor = cursor.parent_folder_id ? byId.get(cursor.parent_folder_id) : null;
	}
	const crumbs: AssetCrumb[] = [{ id: null, label: rootLabel, href: base }];
	let href = base;
	for (const f of chain) {
		href = `${href}/${encodeURIComponent(f.id)}`;
		crumbs.push({ id: f.id, label: clamp(f.name, 160) || "Folder", href });
	}
	return crumbs;
}

// #endregion

// #region Viewer facts

/** The subset of `ids` this viewer has already downloaded (account-level: over-reports, harmlessly). */
async function downloadedOf(actor: Actor, ids: readonly string[]): Promise<Set<string>> {
	const out = new Set<string>();
	if (ids.length === 0) return out;
	const { data, error } = await filesDb(actor).from("download_events")
		.select("item_id").eq("actor_user_id", actor.userId).in("item_id", ids as string[]);
	if (error) return out;
	for (const row of (data ?? []) as Array<{ item_id: string }>) out.add(row.item_id);
	return out;
}

/** The newest LIVE share link the viewer created per item and per folder. */
async function shareSlugsOf(
	actor: Actor,
	itemIds: readonly string[],
	folderIds: readonly string[],
): Promise<{ items: Map<string, string>; folders: Map<string, string> }> {
	const items = new Map<string, string>();
	const folders = new Map<string, string>();
	if (itemIds.length === 0 && folderIds.length === 0) return { items, folders };
	const ors = [
		itemIds.length > 0 ? `item_id.in.(${itemIds.join(",")})` : null,
		folderIds.length > 0 ? `folder_id.in.(${folderIds.join(",")})` : null,
	].filter(Boolean).join(",");
	const { data, error } = await filesDb(actor).from("share_links")
		.select("slug, item_id, folder_id, expires_at, download_limit, download_count, created_at")
		.eq("created_by", actor.userId)
		.is("revoked_at", null)
		.or(ors)
		.order("created_at", { ascending: true });
	if (error) return { items, folders };
	const now = Date.now();
	for (const row of (data ?? []) as Array<{
		slug: string;
		item_id: string | null;
		folder_id: string | null;
		expires_at: string | null;
		download_limit: number | null;
		download_count: number;
	}>) {
		if (row.expires_at && Date.parse(row.expires_at) <= now) continue;
		if (row.download_limit !== null && row.download_count >= row.download_limit) continue;
		// Ascending by creation, so the newest live link per subject is the one left standing.
		if (row.item_id) items.set(row.item_id, row.slug);
		if (row.folder_id) folders.set(row.folder_id, row.slug);
	}
	return { items, folders };
}

// #endregion

// #region Filter, sort, page

function matches(item: AssetItem, params: AssetListParams): boolean {
	if (params.kinds?.length && !params.kinds.includes(item.kind)) return false;
	if (params.sources?.length && !params.sources.includes(item.source)) return false;
	if (params.visibility?.length && !params.visibility.includes(item.visibility)) return false;
	if (params.query) {
		const q = params.query.trim().toLowerCase();
		if (q && !item.name.toLowerCase().includes(q)) return false;
	}
	return true;
}

const SORTERS: Record<FileSortKey, (a: AssetItem, b: AssetItem) => number> = {
	name: (a, b) => a.name.localeCompare(b.name),
	date: (a, b) => a.createdAt.localeCompare(b.createdAt),
	size: (a, b) => a.sizeBytes - b.sizeBytes,
	// A library asset has no sender; "who put it here" falls back to where it lives.
	sender: (a, b) => (a.sender?.name ?? a.source).localeCompare(b.sender?.name ?? b.source),
	type: (a, b) => a.kind.localeCompare(b.kind) || a.ext.localeCompare(b.ext),
};

/** Sort with a stable id tiebreak (a cursor over an unstable order skips and repeats rows), then page. */
function pageOf(items: AssetItem[], params: AssetListParams) {
	const sort: FileSortKey = params.sort ?? "date";
	const dir: FileSortDir = params.dir ?? (sort === "date" ? "desc" : "asc");
	const sorted = items.slice().sort((a, b) => SORTERS[sort](a, b) || a.id.localeCompare(b.id));
	if (dir === "desc") sorted.reverse();
	const limit = Math.min(MAX_LIMIT, Math.max(1, params.limit ?? DEFAULT_LIMIT));
	let start = 0;
	if (params.cursor) {
		const at = sorted.findIndex((it) => it.id === params.cursor);
		start = at >= 0 ? at + 1 : 0;
	}
	const slice = sorted.slice(start, start + limit);
	const hasMore = start + limit < sorted.length;
	return {
		items: slice,
		total: sorted.length,
		hasMore,
		nextCursor: hasMore ? slice[slice.length - 1]?.id ?? null : null,
	};
}

// #endregion

// #region Quota

const PLAN_CODES: ReadonlySet<string> = new Set(Object.keys(PLAN_STORAGE_MIB));

/** What the storage meter says for a plan code. */
function tierLabelFor(plan: string): string {
	if (plan === "organisation") return "Organisation";
	return plan.endsWith("_pro") ? "Pro" : "Free";
}

/** The owner's allowance, from `files.get_storage_quota` (which authorises the caller inside). */
export async function readQuota(actor: Actor, owner: FilesOwner): Promise<Result<StorageQuota>> {
	const { data, error } = await getUserClient(actor.accessToken).schema("files")
		.rpc("get_storage_quota", { p_owner_type: owner.ownerType, p_owner_id: owner.ownerId });
	if (error) {
		if (error.code === "42501") return { ok: false, status: 403, message: "That allowance isn't yours to read." };
		throw new Error(`files.get_storage_quota failed: ${error.message}`);
	}
	const q = data as {
		limit_mib: number | null;
		used_bytes: number | string;
		plan_code: string | null;
		from_grant: boolean;
		enforced: boolean;
	};
	const limitMib = q.limit_mib === null ? null : Math.max(0, Math.floor(q.limit_mib));
	const usedMib = Math.round((bytesOf(q.used_bytes) / (1024 * 1024)) * 10) / 10;
	const remainingMib = limitMib === null ? null : Math.round(Math.max(0, limitMib - usedMib) * 10) / 10;
	const pct = limitMib === null || limitMib === 0
		? 0
		: Math.min(100, Math.max(0, Math.round((usedMib / limitMib) * 1000) / 10));
	const planCode = q.plan_code && PLAN_CODES.has(q.plan_code) ? q.plan_code as PlanCode : null;
	return {
		ok: true,
		data: {
			limitMib,
			usedMib,
			remainingMib,
			pct,
			source: q.from_grant ? "grant" : "plan",
			planCode: planCode ?? (clamp(q.plan_code, 40) || "free"),
			tierLabel: tierLabelFor(q.plan_code ?? ""),
			enforced: q.enforced === true,
		},
	};
}

// #endregion

// #region Hub list

/** One location of the acting library — or of a mounted engagement, addressed by an `mnt-` segment. */
export async function listHub(actor: Actor, params: AssetListParams, base = "/files"): Promise<Result<AssetListPage>> {
	const path = params.path ?? [];
	if (path[0]?.startsWith(MOUNT_PREFIX)) return await listMounted(actor, path[0].slice(MOUNT_PREFIX.length), params, base);

	const owner = libraryFor(actor, params.subjectId);
	const lib = await loadLibrary(actor, owner);
	const folder = path.length > 0
		? walk(lib.folders, path)
		: params.folderId
		? lib.folders.find((f) => f.id === params.folderId) ?? undefined
		: null;
	if (folder === undefined) return { ok: false, status: 404, message: "No such folder." };
	const folderId = folder?.id ?? null;

	const here = lib.items.filter((it) => it.folder_id === folderId);
	const childRows = lib.folders.filter((f) => f.parent_folder_id === folderId);
	const [downloaded, slugs, quota] = await Promise.all([
		downloadedOf(actor, here.map((it) => it.id)),
		shareSlugsOf(actor, here.map((it) => it.id), childRows.map((f) => f.id)),
		readQuota(actor, owner),
	]);
	const ctx: AssetContext = {
		viewerId: actor.userId,
		folderPaths: trails(lib.folders),
		downloaded,
		shareSlugs: slugs.items,
		now: Date.now(),
	};
	const page = pageOf(here.map((row) => toAssetItem(row, ctx)).filter((it) => matches(it, params)), params);
	const sizes = rollups(lib);
	return {
		ok: true,
		data: {
			scope: "hub",
			subjectId: owner.ownerId,
			folderId,
			items: page.items,
			folders: childRows.map((f) =>
				toAssetFolder(f, sizes.get(f.id) ?? { itemCount: 0, sizeBytes: 0 }, {
					viewerId: actor.userId,
					shareSlug: slugs.folders.get(f.id) ?? null,
				})
			),
			crumbs: crumbsTo(lib, folder ?? null, "My files", base),
			hasMore: page.hasMore,
			nextCursor: page.nextCursor,
			total: page.total,
			viewerId: actor.userId,
			readOnly: false,
			quota: quota.ok ? quota.data : null,
		},
	};
}

/**
 * A mounted engagement: the files stored under one project the viewer can open (the `project` bucket,
 * anchored on the project id, readable through `projects.has_project_access`). Read-only here as a
 * matter of product rule — they are managed where they live.
 */
async function listMounted(
	actor: Actor,
	projectSlug: string,
	params: AssetListParams,
	base: string,
): Promise<Result<AssetListPage>> {
	const client = getUserClient(actor.accessToken);
	const project = await client.schema("projects").from("projects")
		.select("id, slug, title").eq("slug", projectSlug).maybeSingle();
	if (project.error) throw new Error(`projects.projects read failed: ${project.error.message}`);
	const p = project.data as { id: string; slug: string; title: string } | null;
	if (!p) return { ok: false, status: 404, message: "No such workspace." };

	const rows = await client.schema("files").from("items").select(ITEM_COLUMNS)
		.eq("bucket_id", "project")
		.like("storage_path", `${p.id}/%`)
		.eq("status", SETTLED)
		.is("deleted_at", null)
		.order("created_at", { ascending: false })
		.limit(LIBRARY_WINDOW);
	if (rows.error) throw new Error(`files.items read failed: ${rows.error.message}`);
	const items = (rows.data ?? []) as unknown as ItemRow[];
	const downloaded = await downloadedOf(actor, items.map((it) => it.id));
	const ctx: AssetContext = {
		viewerId: actor.userId,
		folderPaths: new Map(),
		downloaded,
		shareSlugs: new Map(),
		now: Date.now(),
	};
	const projected = items.map((row) => ({ ...toAssetItem(row, ctx), canManage: false, shareSlug: null }));
	const page = pageOf(projected.filter((it) => matches(it, params)), params);
	const mount = `${MOUNT_PREFIX}${p.slug}`;
	return {
		ok: true,
		data: {
			scope: "hub",
			subjectId: actor.userId,
			folderId: mount,
			items: page.items,
			folders: [],
			crumbs: [
				{ id: null, label: "My files", href: base },
				{ id: mount, label: clamp(p.title, 160) || "Project", href: `${base}/${encodeURIComponent(mount)}` },
			],
			hasMore: page.hasMore,
			nextCursor: page.nextCursor,
			total: page.total,
			viewerId: actor.userId,
			readOnly: true,
			quota: null,
		},
	};
}

// #endregion

// #region Drive list

/** The assets mounted from one connected drive — the caller's own connection, by RLS. */
export async function listDrive(actor: Actor, connectionId: string, params: AssetListParams): Promise<Result<AssetListPage>> {
	const db = filesDb(actor);
	const rows = await db.from("items").select(ITEM_COLUMNS)
		.eq("source_connection_id", connectionId)
		.is("deleted_at", null)
		.order("created_at", { ascending: false })
		.limit(LIBRARY_WINDOW);
	if (rows.error) throw new Error(`files.items read failed: ${rows.error.message}`);
	const items = (rows.data ?? []) as unknown as ItemRow[];
	const ctx: AssetContext = {
		viewerId: actor.userId,
		folderPaths: new Map(),
		downloaded: await downloadedOf(actor, items.map((it) => it.id)),
		shareSlugs: new Map(),
		now: Date.now(),
	};
	const page = pageOf(items.map((row) => ({ ...toAssetItem(row, ctx), canManage: false })).filter((it) => matches(it, params)), params);
	return {
		ok: true,
		data: {
			scope: "drive",
			subjectId: connectionId,
			folderId: null,
			items: page.items,
			folders: [],
			crumbs: [],
			hasMore: page.hasMore,
			nextCursor: page.nextCursor,
			total: page.total,
			viewerId: actor.userId,
			readOnly: true,
			quota: null,
		},
	};
}

// #endregion

// #region Tree

/** The `/files` navigation tree: the acting library, the mounted engagements, the connected drives. */
export async function readTree(actor: Actor): Promise<AssetTreeNode[]> {
	const owner = ownerOfActor(actor);
	const client = getUserClient(actor.accessToken);
	const [lib, mounts, drives] = await Promise.all([
		loadLibrary(actor, owner),
		// Every project-bucket file the viewer can read, grouped by the project it is anchored on.
		client.schema("files").from("items").select("storage_path")
			.eq("bucket_id", "project").eq("status", SETTLED).is("deleted_at", null).limit(LIBRARY_WINDOW),
		client.schema("integrations").from("v_my_connections")
			.select("id, provider_slug, provider_label, external_account_label, status")
			.limit(50),
	]);
	if (mounts.error) throw new Error(`files.items read failed: ${mounts.error.message}`);

	const counts = new Map<string, number>();
	for (const f of lib.folders) counts.set(f.id, 0);
	const parent = new Map(lib.folders.map((f) => [f.id, f.parent_folder_id]));
	for (const it of lib.items) {
		let cursor: string | null | undefined = it.folder_id;
		let guard = 0;
		while (cursor && guard++ < 32) {
			counts.set(cursor, (counts.get(cursor) ?? 0) + 1);
			cursor = parent.get(cursor);
		}
	}
	const node = (f: FolderRow): AssetTreeNode => ({
		segment: f.id,
		kind: "dir",
		nodeKind: "folder",
		label: clamp(f.name, 200) || "Folder",
		sublabel: null,
		folderId: f.id,
		readOnly: false,
		fileCount: counts.get(f.id) ?? 0,
		children: lib.folders.filter((c) => c.parent_folder_id === f.id).map(node),
	});
	const root: AssetTreeNode = {
		segment: "root",
		kind: "stage",
		nodeKind: "root",
		label: "My files",
		sublabel: null,
		folderId: null,
		readOnly: false,
		fileCount: lib.items.length,
		children: lib.folders.filter((f) => f.parent_folder_id === null).map(node),
	};

	const perProject = new Map<string, number>();
	for (const row of (mounts.data ?? []) as Array<{ storage_path: string }>) {
		const anchor = row.storage_path.split("/")[0];
		if (anchor) perProject.set(anchor, (perProject.get(anchor) ?? 0) + 1);
	}
	const projectNodes: AssetTreeNode[] = [];
	if (perProject.size > 0) {
		const projects = await client.schema("projects").from("projects")
			.select("id, slug, title").in("id", [...perProject.keys()]);
		if (projects.error) throw new Error(`projects.projects read failed: ${projects.error.message}`);
		for (const p of (projects.data ?? []) as Array<{ id: string; slug: string; title: string }>) {
			projectNodes.push({
				segment: `${MOUNT_PREFIX}${p.slug}`,
				kind: "stage",
				nodeKind: "project",
				label: clamp(p.title, 200) || "Project",
				sublabel: "Shared in this engagement",
				folderId: `${MOUNT_PREFIX}${p.slug}`,
				readOnly: true,
				fileCount: perProject.get(p.id) ?? 0,
				children: [],
			});
		}
		projectNodes.sort((a, b) => a.label.localeCompare(b.label));
	}

	// A drive the connections view could not answer for is simply absent — the library still renders.
	const driveNodes: AssetTreeNode[] = drives.error ? [] : ((drives.data ?? []) as Array<{
		id: string;
		provider_slug: string;
		provider_label: string | null;
		external_account_label: string | null;
		status: string;
	}>).filter((c) => c.status === "active").map((c) => ({
		segment: c.id,
		kind: "stage",
		nodeKind: "drive",
		label: clamp(c.provider_label, 200) || c.provider_slug,
		sublabel: clamp(c.external_account_label, 200) || "Connected account",
		folderId: c.id,
		readOnly: true,
		fileCount: 0,
		children: [],
	}));

	return [root, ...projectNodes, ...driveNodes];
}

// #endregion

// #region Single asset

/** One asset the caller may read, projected for them. `null` when RLS says it is not theirs to see. */
export async function readAsset(actor: Actor, id: string): Promise<AssetItem | null> {
	const { data, error } = await filesDb(actor).from("items").select(ITEM_COLUMNS)
		.eq("id", id).is("deleted_at", null).maybeSingle();
	if (error) {
		// A malformed id is "no such file", not an outage.
		if (error.code === "22P02") return null;
		throw new Error(`files.items read failed: ${error.message}`);
	}
	const row = data as unknown as ItemRow | null;
	if (!row) return null;
	const [downloaded, slugs, folderPath] = await Promise.all([
		downloadedOf(actor, [row.id]),
		shareSlugsOf(actor, [row.id], []),
		row.folder_id
			? filesDb(actor).from("folders").select("id, name, path").eq("id", row.folder_id).maybeSingle()
			: Promise.resolve({ data: null, error: null }),
	]);
	const trailsMap = new Map<string, string[]>();
	const f = folderPath.data as { id: string; name: string | null; path: string[] | null } | null;
	if (f) trailsMap.set(f.id, folderTrail(f));
	return toAssetItem(row, {
		viewerId: actor.userId,
		folderPaths: trailsMap,
		downloaded,
		shareSlugs: slugs.items,
		now: Date.now(),
	});
}

// #endregion

// #region Dedup

/**
 * Positional duplicate verdicts for one drop, searched within ONE library the caller may file into
 * (the acting one unless an upload names the person's own) — a check that accepted any owner would be
 * a content-addressed read of a library the caller may not hold, and RLS bounds the rows regardless. A
 * name collision is scoped to the target folder: the same name in two folders is filing, not a clash.
 */
export async function dedupVerdicts(
	actor: Actor,
	input: DedupCheck,
	owner: FilesOwner = ownerOfActor(actor),
): Promise<DedupVerdict[]> {
	const db = filesDb(actor);
	const hashes = [...new Set(input.fingerprints.map((p) => p.hash))];
	const names = (input.names ?? []).filter((n) => n.length > 0);
	const [byHash, byName] = await Promise.all([
		// Only a settled copy is a duplicate. An upload declares its CLIENT fingerprint as `content_hash`
		// up front, so without this an abandoned or refused declaration would match every later attempt
		// at the same bytes and the person could never store the file.
		db.from("items").select(ITEM_COLUMNS).match(libraryMatch(owner))
			.is("deleted_at", null).eq("purpose", "library").eq("status", SETTLED).in("content_hash", hashes),
		names.length > 0
			? (input.folderId
				? db.from("items").select(ITEM_COLUMNS).match(libraryMatch(owner)).eq("folder_id", input.folderId)
				: db.from("items").select(ITEM_COLUMNS).match(libraryMatch(owner)).is("folder_id", null))
				.is("deleted_at", null).eq("purpose", "library").eq("status", SETTLED).in("display_name", names)
			: Promise.resolve({ data: [], error: null }),
	]);
	if (byHash.error) throw new Error(`files.items read failed: ${byHash.error.message}`);
	if (byName.error) throw new Error(`files.items read failed: ${byName.error.message}`);
	const ctx: AssetContext = {
		viewerId: actor.userId,
		folderPaths: new Map(),
		downloaded: new Set(),
		shareSlugs: new Map(),
		now: Date.now(),
	};
	const hashRows = (byHash.data ?? []) as unknown as ItemRow[];
	const nameRows = (byName.data ?? []) as unknown as ItemRow[];
	return input.fingerprints.map((print, index) => {
		const hit = hashRows.find((r) => r.content_hash === print.hash);
		if (hit) return { verdict: "exact_duplicate" as const, existing: toAssetItem(hit, ctx) };
		const name = input.names?.[index];
		const clash = name ? nameRows.find((r) => r.display_name === name) : undefined;
		if (clash) return { verdict: "name_collision" as const, existing: toAssetItem(clash, ctx) };
		return { verdict: "new" as const, existing: null };
	});
}

// #endregion

// #region Downloads

/** Whether this viewer has already taken a copy of an asset they can read. */
export async function readDownloadGuard(actor: Actor, assetId: string): Promise<Result<DownloadGuard>> {
	if (!await readAsset(actor, assetId)) return { ok: false, status: 404, message: "No such file." };
	const { data, error } = await filesDb(actor).from("download_events")
		.select("downloaded_at, device_fingerprint")
		.eq("item_id", assetId).eq("actor_user_id", actor.userId)
		.order("downloaded_at", { ascending: false }).limit(1);
	if (error) throw new Error(`files.download_events read failed: ${error.message}`);
	const last = ((data ?? []) as Array<{ downloaded_at: string; device_fingerprint: string | null }>)[0];
	return {
		ok: true,
		data: {
			alreadyDownloaded: !!last,
			lastAt: last?.downloaded_at ?? null,
			lastDeviceLabel: last ? (last.device_fingerprint ? "Another device" : "This account") : null,
		},
	};
}

/**
 * A keyset-paged slice of the download ledger — for one asset, one actor, or the viewer's library.
 * RLS bounds it to events the viewer took or on assets they own.
 */
export async function readHistory(actor: Actor, params: {
	assetId?: string;
	actorId?: string;
	cursor?: string | null;
	limit?: number;
}): Promise<DownloadHistoryPage> {
	const limit = Math.min(100, Math.max(1, params.limit ?? 30));
	let q = filesDb(actor).from("download_events")
		.select("id, item_id, actor_user_id, device_fingerprint, via, share_slug, downloaded_at", { count: "exact" })
		.order("downloaded_at", { ascending: false })
		.order("id", { ascending: false })
		.limit(limit + 1);
	if (params.assetId) q = q.eq("item_id", params.assetId);
	if (params.actorId) q = q.eq("actor_user_id", params.actorId);
	if (params.cursor) {
		const [at, id] = params.cursor.split("|");
		if (at && id) q = q.or(`downloaded_at.lt.${at},and(downloaded_at.eq.${at},id.lt.${id})`);
	}
	const { data, error, count } = await q;
	if (error) throw new Error(`files.download_events read failed: ${error.message}`);
	const rows = (data ?? []) as Array<{
		id: string;
		item_id: string;
		actor_user_id: string | null;
		device_fingerprint: string | null;
		via: DownloadEvent["via"];
		share_slug: string | null;
		downloaded_at: string;
	}>;
	const pageRows = rows.slice(0, limit);
	const itemIds = [...new Set(pageRows.map((r) => r.item_id))];
	const actorIds = [...new Set(pageRows.flatMap((r) => r.actor_user_id ? [r.actor_user_id] : []))];
	const client = getUserClient(actor.accessToken);
	const [names, handles] = await Promise.all([
		itemIds.length > 0
			? client.schema("files").from("items").select("id, display_name").in("id", itemIds)
			: Promise.resolve({ data: [], error: null }),
		actorIds.length > 0
			? client.schema("org").from("users_public").select("user_id, username").in("user_id", actorIds)
			: Promise.resolve({ data: [], error: null }),
	]);
	const nameOf = new Map(((names.data ?? []) as Array<{ id: string; display_name: string }>).map((r) => [r.id, r.display_name]));
	const handleOf = new Map(((handles.data ?? []) as Array<{ user_id: string; username: string }>).map((r) => [r.user_id, r.username]));
	const events: DownloadEvent[] = pageRows.map((r) => ({
		id: r.id,
		assetId: r.item_id,
		assetName: clamp(nameOf.get(r.item_id), 200) || "A file",
		actorId: r.actor_user_id,
		actorHandle: r.actor_user_id ? clamp(handleOf.get(r.actor_user_id), 40) || null : null,
		via: r.via,
		shareSlug: r.share_slug,
		deviceFingerprint: r.device_fingerprint ? clamp(r.device_fingerprint, 120) : null,
		at: r.downloaded_at,
		dateLabel: clamp(fmtDateTime(Date.parse(r.downloaded_at)), 28),
	}));
	const last = pageRows[pageRows.length - 1];
	return {
		events,
		hasMore: rows.length > limit,
		nextCursor: rows.length > limit && last ? `${last.downloaded_at}|${last.id}` : null,
		total: count ?? events.length,
	};
}

// #endregion

// #region Shares — the anonymous side

/** What a live share slug reaches, from the one visitor-callable door. `null` when it reaches nothing. */
export async function shareTarget(slug: string): Promise<{ itemId: string | null; folderId: string | null } | null> {
	const { data, error } = await getAnonClient().schema("files").rpc("fn_resolve_share", { p_slug: slug });
	if (error) throw new Error(`files.fn_resolve_share failed: ${error.message}`);
	const row = ((data ?? []) as Array<{ item_id: string | null; folder_id: string | null }>)[0];
	return row ? { itemId: row.item_id, folderId: row.folder_id } : null;
}

/**
 * An asset as a share recipient sees it: no filing, no management, no slug of its own, and a URL that
 * carries the slug — the credential that lets the object route serve a private file to someone with no
 * account.
 */
function asShared(row: ItemRow, slug: string, now: number): AssetItem {
	const item = toAssetItem(row, {
		viewerId: "",
		folderPaths: new Map(),
		downloaded: new Set(),
		shareSlugs: new Map(),
		now,
	});
	const privately = row.source === "supabase" && row.status === "uploaded" && !isPublicBucket(row.bucket_id);
	return {
		...item,
		folderId: null,
		folderPath: [],
		canManage: false,
		shareSlug: null,
		url: privately ? fileObjectHref(row.id, { share: slug }) : item.url,
		thumbnailUrl: privately && item.kind === "image" ? fileObjectHref(row.id, { tier: "sm", share: slug }) : item.thumbnailUrl,
	};
}

/**
 * Resolve a slug to the one asset it shares. Every dead state — unknown, expired, revoked, exhausted,
 * a folder link — answers `not_found`: telling a stranger which one it was confirms a link existed.
 */
export async function resolveShareSlug(slug: string): Promise<ShareResolution> {
	const target = await shareTarget(slug);
	if (!target?.itemId) return { state: "not_found" };
	// The service role reads the row because the recipient has no session and a link-visibility asset is
	// deliberately not readable by id (fn_can_read refuses it) — the slug, just validated, is the grant.
	const { data, error } = await getServiceClient().schema("files").from("items").select(ITEM_COLUMNS)
		.eq("id", target.itemId).eq("status", SETTLED).is("deleted_at", null).maybeSingle();
	if (error) throw new Error(`files.items read failed: ${error.message}`);
	const row = data as unknown as ItemRow | null;
	return row ? { state: "ok", asset: asShared(row, slug, Date.now()) } : { state: "not_found" };
}

/** A folder link's contents, as the recipient sees them. */
export async function listShare(slug: string, params: AssetListParams): Promise<Result<AssetListPage>> {
	const target = await shareTarget(slug);
	if (!target) return { ok: false, status: 404, message: "Not found." };
	const service = getServiceClient().schema("files");
	const rows = target.itemId
		? await service.from("items").select(ITEM_COLUMNS).eq("id", target.itemId).eq("status", SETTLED)
			.is("deleted_at", null)
		: await service.from("items").select(ITEM_COLUMNS).eq("folder_id", target.folderId!).eq("status", SETTLED)
			.is("deleted_at", null).eq("purpose", "library").order("created_at", { ascending: false })
			.limit(LIBRARY_WINDOW);
	if (rows.error) throw new Error(`files.items read failed: ${rows.error.message}`);
	const now = Date.now();
	const items = ((rows.data ?? []) as unknown as ItemRow[]).map((row) => asShared(row, slug, now));
	const page = pageOf(items.filter((it) => matches(it, params)), params);
	return {
		ok: true,
		data: {
			scope: "share",
			subjectId: slug,
			folderId: target.folderId,
			items: page.items,
			folders: [],
			crumbs: [],
			hasMore: page.hasMore,
			nextCursor: page.nextCursor,
			total: page.total,
			viewerId: "",
			readOnly: true,
			quota: null,
		},
	};
}

// #endregion

export type { AssetFolder };
