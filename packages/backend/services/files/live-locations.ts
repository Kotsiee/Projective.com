import type {
	AssetCrumb,
	AssetListPage,
	AssetListParams,
	AssetTreeNode,
} from "@projective/types/files";
import {
	driveAddressOf,
	DRIVES_SEGMENT,
	folderHref,
	isMountPath,
	MOUNT_PREFIX,
} from "@projective/types/files";
import type { SubmissionTreeNode } from "@projective/types/projects";
import type { ServiceResult } from "../ServiceResult.ts";
import type { ReadActor } from "../read-actor.ts";
import { IntegrationsBackendService } from "../integrations/IntegrationsBackendService.ts";
import { ProjectBackendService } from "../projects/ProjectBackendService.ts";
import { assetMatches, nameMatches, needleOf } from "./list-filter.ts";
import { driveLabel } from "./live-library.ts";

/**
 * live-locations — the hub locations whose contents live somewhere else: a folder of a connected
 * drive (`/files/drives/{connectionId}/{folderId…}`) and a node of a mounted engagement's submissions
 * (`/files/mnt-{slug}/{segment…}`). Each is read through the domain that owns it, so the provider's
 * paging and the submissions isolation rule apply here exactly as they do on their own surfaces, and
 * each answers as a read-only `hub` page, so the body renders it with the components it already has.
 *
 * The same reads feed the navigation tree's lazy children ({@link childNodesOf}): a drive's folders
 * cannot arrive with the tree, because nobody can bound a provider's hierarchy in one payload.
 *
 * `/files` is the only base these addresses exist under; a team's or business's drive mounts neither.
 */

type Actor = ReadActor & { accessToken: string };
type Outcome<T> =
	| { ok: true; data: T; status?: number; message?: string }
	| { ok: false; status: number; message: string; errors?: Record<string, string> };

const BASE = "/files";
const LIBRARY_LABEL = "Library";
/** The drive page a read asks for when the caller names none, and the most the browse contract allows. */
const DRIVE_PAGE = 100;
const DRIVE_PAGE_MAX = 200;

/** A failed domain read as a page outcome. */
function refused<T>(res: ServiceResult<unknown>): Outcome<T> {
	return {
		ok: false,
		status: res.status ?? 503,
		message: res.message ?? "That location could not be read.",
		errors: res.errors,
	};
}

// #region Drive
async function listDrive(
	actor: Actor,
	address: { connectionId: string; folderIds: string[] },
	params: AssetListParams,
): Promise<Outcome<AssetListPage>> {
	const { connectionId, folderIds } = address;
	const res = await IntegrationsBackendService.browseLocation({
		connectionId,
		folderIds,
		cursor: params.cursor ?? null,
		limit: Math.min(params.limit ?? DRIVE_PAGE, DRIVE_PAGE_MAX),
	}, actor);
	if (!res.ok || !res.data) return refused(res);
	const { page, connection, trail } = res.data;

	const root = [DRIVES_SEGMENT, connectionId];
	const crumbs: AssetCrumb[] = [
		{ id: null, label: LIBRARY_LABEL, href: BASE },
		{
			id: connectionId,
			label: driveLabel(connection.providerSlug, connection.providerLabel),
			href: folderHref(BASE, root),
		},
		...trail.map((folder, i) => ({
			id: folder.id,
			label: folder.name,
			href: folderHref(BASE, [...root, ...folderIds.slice(0, i + 1)]),
		})),
	];

	// shortcut: search and the facet filters narrow the page the provider sent, and the sort stays the
	// provider's; pass them to `adapter.list` when a drive folder outgrows one page.
	const needle = needleOf(params);
	const items = page.entries.filter((asset) => assetMatches(asset, params));
	return {
		ok: true,
		data: {
			scope: "hub",
			subjectId: actor.userId,
			folderId: folderIds.at(-1) ?? connectionId,
			items,
			folders: page.folders.filter((folder) => nameMatches(needle, folder.name)),
			crumbs,
			hasMore: page.hasMore,
			nextCursor: page.nextCursor,
			total: items.length,
			viewerId: actor.userId,
			readOnly: true,
			quota: null,
		},
	};
}

async function driveChildren(
	actor: Actor,
	address: { connectionId: string; folderIds: string[] },
): Promise<Outcome<AssetTreeNode[]>> {
	const res = await IntegrationsBackendService.browse({
		connectionId: address.connectionId,
		folderId: address.folderIds.at(-1) ?? null,
		// shortcut: the first page only, where Drive sorts folders first; page it when a drive folder
		// holds more than this many subfolders.
		limit: DRIVE_PAGE_MAX,
	}, actor);
	if (!res.ok || !res.data) return refused(res);
	return {
		ok: true,
		data: res.data.folders.map((folder) => ({
			segment: folder.externalFolderId ?? folder.id,
			kind: "dir",
			nodeKind: "mount",
			label: folder.name,
			sublabel: null,
			folderId: null,
			readOnly: true,
			fileCount: 0,
			children: [],
		})),
	};
}
// #endregion

// #region Mounted engagement
function mountNode(node: SubmissionTreeNode): AssetTreeNode {
	return {
		segment: node.segment,
		kind: node.kind,
		nodeKind: "mount",
		label: node.label,
		sublabel: node.sublabel ?? null,
		avatar: node.avatar ?? null,
		handle: node.handle ?? null,
		folderId: null,
		readOnly: true,
		fileCount: node.fileCount,
		children: node.children.map(mountNode),
	};
}

async function listSubmissions(
	actor: Actor,
	[mount, ...nodePath]: string[],
	params: AssetListParams,
): Promise<Outcome<AssetListPage>> {
	const res = await ProjectBackendService.submissions({
		projectId: mount.slice(MOUNT_PREFIX.length),
		path: nodePath,
		sort: params.sort,
		dir: params.dir,
		kinds: params.kinds,
		query: params.query,
		cursor: params.cursor,
		limit: params.limit,
	}, actor);
	if (!res.ok || !res.data) return refused(res);
	const { page } = res.data;
	const items = page.items.filter((asset) => assetMatches(asset, params))
		.map((asset) => ({ ...asset, canManage: false, shareSlug: null }));
	return {
		ok: true,
		data: {
			scope: "hub",
			subjectId: actor.userId,
			folderId: mount,
			items,
			folders: [],
			crumbs: [
				{ id: null, label: LIBRARY_LABEL, href: BASE },
				{ id: mount, label: page.projectTitle, href: folderHref(BASE, [mount]) },
				...page.breadcrumbs.filter((crumb) => crumb.path.length > 0).map((crumb) => ({
					id: null,
					label: crumb.label,
					href: folderHref(BASE, [mount, ...crumb.path]),
				})),
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

async function mountChildren(actor: Actor, mount: string): Promise<Outcome<AssetTreeNode[]>> {
	const res = await ProjectBackendService.submissions({
		projectId: mount.slice(MOUNT_PREFIX.length),
		limit: 1,
	}, actor);
	if (!res.ok || !res.data) return refused(res);
	return { ok: true, data: res.data.page.tree.map(mountNode) };
}
// #endregion

// #region Doors
/**
 * The page for a hub path that lives outside the library, or `null` for a path the library resolves
 * itself (a mount's own root keeps `listHub`'s flat view of everything stored under the project).
 */
export function listElsewhere(
	actor: Actor,
	params: AssetListParams,
): Promise<Outcome<AssetListPage>> | null {
	const address = driveAddressOf(params.path);
	if (address) return listDrive(actor, address, params);
	const path = params.path ?? [];
	return isMountPath(path) && path.length > 1 ? listSubmissions(actor, path, params) : null;
}

/** The nodes beneath a drive or a mounted engagement, for the tree's lazy children. */
export function childNodesOf(actor: Actor, path: string[]): Promise<Outcome<AssetTreeNode[]>> {
	const address = driveAddressOf(path);
	if (address) return driveChildren(actor, address);
	if (isMountPath(path)) return mountChildren(actor, path[0]);
	return Promise.resolve({ ok: false, status: 404, message: "Nothing is mounted there." });
}
// #endregion
