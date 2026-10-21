import type { AssetItem } from "@projective/types/files";
import { FrameIoConnectionConfigSchema } from "@projective/types/integrations";
import {
	bearerOf,
	configOf,
	connectorAsset,
	connectorFolder,
	continuation,
	netOf,
	orNull,
	pageSize,
	providerJson,
} from "./adapter-support.ts";
import {
	type DrivePath,
	type StorageAdapter,
	type StorageAdapterContext,
	StorageAdapterError,
	type StorageListing,
} from "./StorageAdapter.ts";

/**
 * FrameIoAdapter — the `frameio` connector, over the Frame.io **V4** API (Adobe IMS OAuth).
 *
 * The legacy V2 API stops being served on 2026-12-01, so this client speaks V4 only (Decision #313):
 *
 * - **Root** — V4 has no account-wide tree. A connection names ONE project (its `root_folder_id` is
 *   the root) or a workspace (its projects ARE the root, each a folder at its project's root folder).
 * - **List** — `GET /v4/accounts/{account}/folders/{folder}/children`. A `version_stack` lists as its
 *   head version — the cut a reviewer approved — and a stack with no head is skipped.
 * - **Paging** — `links.next` is a path holding only the `after` cursor (every other parameter must be
 *   re-sent), so the cursor is that `after` value alone and nothing URL-shaped is ever followed.
 * - **Download / thumbnail** — `include=media_links.original` / `media_links.thumbnail` on the file.
 *   Frame.io answers `403` where the project withholds downloads and `null` for a link it cannot give
 *   (watermarked, still transcoding); both read as "no URL".
 */

const API = "https://api.frame.io/v4";
const PROVIDER = "Frame.io";

interface FrameIoNode {
	id: string;
	name?: string;
	type?: "file" | "folder" | "version_stack";
	parent_id?: string | null;
	file_size?: number;
	media_type?: string | null;
	updated_at?: string;
	view_url?: string;
	head_version?: FrameIoNode | null;
	media_links?: {
		original?: { download_url?: string | null } | null;
		thumbnail?: { url?: string | null } | null;
	};
}

interface FrameIoProject {
	id: string;
	name?: string;
	root_folder_id?: string;
	updated_at?: string;
}

interface FrameIoPage<T> {
	data?: T[];
	links?: { next?: string | null };
}

/** The `after` cursor a `links.next` path carries. */
function afterOf(next: string | null | undefined): string | null {
	if (!next) return null;
	const query = next.includes("?") ? next.slice(next.indexOf("?") + 1) : "";
	return continuation(new URLSearchParams(query).get("after"), PROVIDER);
}

/** Construct the Frame.io connector for one connection. */
export function createFrameIoAdapter(ctx: StorageAdapterContext): StorageAdapter {
	const net = netOf(ctx);
	const config = configOf(FrameIoConnectionConfigSchema, ctx.connection, PROVIDER);
	const headers = {
		authorization: `Bearer ${bearerOf(ctx, PROVIDER)}`,
		accept: "application/json",
	};
	const account = `${API}/accounts/${encodeURIComponent(config.accountId)}`;

	function get<T>(path: string, params: Record<string, string> = {}): Promise<T> {
		const query = new URLSearchParams(params).toString();
		return providerJson<T>(net, PROVIDER, `${account}${path}${query ? `?${query}` : ""}`, {
			headers,
		});
	}

	function file(id: string, include?: string): Promise<{ data?: FrameIoNode } | null> {
		return orNull(
			get<{ data?: FrameIoNode }>(`/files/${encodeURIComponent(id)}`, include ? { include } : {}),
		);
	}

	function toAsset(node: FrameIoNode, parentId: string | null, now: number): AssetItem {
		return connectorAsset("frameio", ctx.connection, {
			externalId: node.id,
			parentId,
			name: node.name ?? "",
			mimeType: node.media_type ?? null,
			sizeBytes: node.file_size ?? 0,
			modifiedAt: node.updated_at ?? null,
			webUrl: node.view_url ?? null,
			etag: node.updated_at ?? null,
		}, now);
	}

	async function rootFolderOf(projectId: string): Promise<string> {
		const project = await get<{ data?: FrameIoProject }>(
			`/projects/${encodeURIComponent(projectId)}`,
		);
		const root = project.data?.root_folder_id;
		if (!root) {
			throw new StorageAdapterError("not_found", `${PROVIDER}: the project has no root folder.`);
		}
		return root;
	}

	async function projects(
		workspaceId: string,
		cursor: string | null,
		size: number,
	): Promise<StorageListing> {
		const params: Record<string, string> = { page_size: String(size) };
		if (cursor) params.after = cursor;
		const page = await get<FrameIoPage<FrameIoProject>>(
			`/workspaces/${encodeURIComponent(workspaceId)}/projects`,
			params,
		);
		const now = net.now().getTime();
		return {
			entries: [],
			folders: (page.data ?? []).flatMap((p) =>
				p.root_folder_id
					? [connectorFolder("frameio", ctx.connection, {
						externalId: p.root_folder_id,
						parentId: null,
						name: p.name ?? "",
						itemCount: 0,
						modifiedAt: p.updated_at ?? null,
					}, now)]
					: []
			),
			hasMore: Boolean(page.links?.next),
			nextCursor: afterOf(page.links?.next),
		};
	}

	async function children(
		folderId: string,
		parentId: string | null,
		cursor: string | null,
		size: number,
	): Promise<StorageListing> {
		const params: Record<string, string> = { page_size: String(size) };
		if (cursor) params.after = cursor;
		const page = await get<FrameIoPage<FrameIoNode>>(
			`/folders/${encodeURIComponent(folderId)}/children`,
			params,
		);
		const now = net.now().getTime();
		const listing: StorageListing = {
			entries: [],
			folders: [],
			hasMore: Boolean(page.links?.next),
			nextCursor: afterOf(page.links?.next),
		};
		for (const node of page.data ?? []) {
			if (node.type === "folder") {
				listing.folders.push(connectorFolder("frameio", ctx.connection, {
					externalId: node.id,
					parentId,
					name: node.name ?? "",
					itemCount: 0,
					modifiedAt: node.updated_at ?? null,
				}, now));
			} else if (node.type === "version_stack") {
				if (node.head_version) {
					listing.entries.push(toAsset({ ...node.head_version, name: node.name }, parentId, now));
				}
			} else {
				listing.entries.push(toAsset(node, parentId, now));
			}
		}
		return listing;
	}

	return {
		slug: "frameio",
		source: "frameio",

		async list(path: DrivePath, cursor: string | null, limit: number): Promise<StorageListing> {
			const size = pageSize(limit, 500);
			if (path.folderId) return children(path.folderId, path.folderId, cursor, size);
			if (config.projectId) {
				return children(await rootFolderOf(config.projectId), null, cursor, size);
			}
			return projects(config.workspaceId ?? "", cursor, size);
		},

		async metadata(id: string): Promise<AssetItem | null> {
			const node = (await file(id))?.data;
			if (!node || node.type === "folder") return null;
			return toAsset(node, node.parent_id ?? null, net.now().getTime());
		},

		async downloadUrl(id: string): Promise<string | null> {
			try {
				return (await file(id, "media_links.original"))?.data?.media_links?.original
					?.download_url ?? null;
			} catch (error) {
				if (error instanceof StorageAdapterError && error.code === "forbidden") return null;
				throw error;
			}
		},

		async thumbnailUrl(id: string): Promise<string | null> {
			try {
				return (await file(id, "media_links.thumbnail"))?.data?.media_links?.thumbnail?.url ?? null;
			} catch (error) {
				if (error instanceof StorageAdapterError && error.code === "forbidden") return null;
				throw error;
			}
		},
	};
}
