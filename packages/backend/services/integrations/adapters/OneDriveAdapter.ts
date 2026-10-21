import type { AssetItem } from "@projective/types/files";
import { OneDriveConnectionConfigSchema } from "@projective/types/integrations";
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
 * OneDriveAdapter — the `onedrive` connector: a person's OneDrive, or a SharePoint document library,
 * over Microsoft Graph v1.0. Both are Graph `drive`s, so one client serves them (Decision #313).
 *
 * - **Drive** — `/me/drive`, or `/drives/{config.driveId}` for a SharePoint library.
 * - **List** — `GET …/items/{id}/children` (or `…/root/children`) with `$top` and an explicit `$select`.
 * - **Paging** — Graph pages by a full `@odata.nextLink` URL. The cursor carries its PATH only, and a
 *   cursor is followed only against Graph's fixed origin and only into a drive path: echoed back from a
 *   client, a full URL would let a forged cursor carry this person's bearer token to any host.
 * - **Shared folders** a person added to their OneDrive arrive as `remoteItem`s living in ANOTHER
 *   drive; their ids are `{driveId}:{itemId}` so browsing into one addresses the right drive.
 * - **Download** — `@microsoft.graph.downloadUrl`, pre-authenticated and short-lived, read per call.
 * - **Thumbnail** — `…/thumbnails`, the `medium` rendition's URL, read per call.
 */

const GRAPH = "https://graph.microsoft.com";
const PROVIDER = "OneDrive";
const SELECT =
	"id,name,size,file,folder,package,parentReference,webUrl,eTag,lastModifiedDateTime," +
	"image,video,remoteItem";
const DRIVE_PATH = /^\/v1\.0\/(?:me\/drive\/|drives\/)/;

interface GraphItem {
	id: string;
	name?: string;
	size?: number;
	file?: { mimeType?: string };
	folder?: { childCount?: number };
	parentReference?: { driveId?: string; id?: string };
	webUrl?: string;
	eTag?: string;
	lastModifiedDateTime?: string;
	image?: { width?: number; height?: number };
	video?: { width?: number; height?: number; duration?: number };
	remoteItem?: GraphItem;
	"@microsoft.graph.downloadUrl"?: string;
}

interface GraphPage {
	value?: GraphItem[];
	"@odata.nextLink"?: string;
}

/** Construct the OneDrive / SharePoint connector for one connection. */
export function createOneDriveAdapter(ctx: StorageAdapterContext): StorageAdapter {
	const net = netOf(ctx);
	const config = configOf(OneDriveConnectionConfigSchema, ctx.connection, PROVIDER);
	const headers = {
		authorization: `Bearer ${bearerOf(ctx, PROVIDER)}`,
		accept: "application/json",
	};
	const drive = config.driveId
		? `/v1.0/drives/${encodeURIComponent(config.driveId)}`
		: "/v1.0/me/drive";

	function itemPath(id: string): string {
		const split = id.indexOf(":");
		if (split > 0) {
			const driveId = encodeURIComponent(id.slice(0, split));
			return `/v1.0/drives/${driveId}/items/${encodeURIComponent(id.slice(split + 1))}`;
		}
		return `${drive}/items/${encodeURIComponent(id)}`;
	}

	function get<T>(pathAndQuery: string): Promise<T> {
		return providerJson<T>(net, PROVIDER, `${GRAPH}${pathAndQuery}`, { headers });
	}

	function resume(cursor: string): string {
		const url = cursor.startsWith("/v1.0/") ? new URL(`${GRAPH}${cursor}`) : null;
		if (!url || url.origin !== GRAPH || !DRIVE_PATH.test(url.pathname)) {
			throw new StorageAdapterError("forbidden", `${PROVIDER}: that page can't be resumed.`);
		}
		return `${url.pathname}${url.search}`;
	}

	function cursorOf(nextLink: string | undefined): string | null {
		if (!nextLink) return null;
		if (!nextLink.startsWith(`${GRAPH}/v1.0/`)) {
			throw new StorageAdapterError(
				"provider_error",
				`${PROVIDER} returned an unexpected next page.`,
			);
		}
		return continuation(nextLink.slice(GRAPH.length), PROVIDER);
	}

	function idOf(item: GraphItem): string {
		const remote = item.remoteItem;
		return remote?.id && remote.parentReference?.driveId
			? `${remote.parentReference.driveId}:${remote.id}`
			: item.id;
	}

	function toAsset(item: GraphItem, parentId: string | null, now: number): AssetItem {
		const facet = item.remoteItem ?? item;
		const media = facet.video ?? facet.image;
		return connectorAsset("onedrive", ctx.connection, {
			externalId: idOf(item),
			parentId,
			name: item.name ?? facet.name ?? "",
			mimeType: facet.file?.mimeType ?? null,
			sizeBytes: facet.size ?? item.size ?? 0,
			modifiedAt: item.lastModifiedDateTime ?? facet.lastModifiedDateTime ?? null,
			webUrl: item.webUrl ?? facet.webUrl ?? null,
			etag: facet.eTag ?? item.eTag ?? null,
			width: media?.width ?? null,
			height: media?.height ?? null,
			durationMs: facet.video?.duration ?? null,
		}, now);
	}

	return {
		slug: "onedrive",
		source: "onedrive",

		async list(path: DrivePath, cursor: string | null, limit: number): Promise<StorageListing> {
			const level = path.folderId ? itemPath(path.folderId) : `${drive}/root`;
			const page = await get<GraphPage>(
				cursor
					? resume(cursor)
					: `${level}/children?$top=${pageSize(limit, 200)}&$select=${SELECT}`,
			);
			const now = net.now().getTime();
			const listing: StorageListing = {
				entries: [],
				folders: [],
				hasMore: Boolean(page["@odata.nextLink"]),
				nextCursor: cursorOf(page["@odata.nextLink"]),
			};
			for (const item of page.value ?? []) {
				const folder = item.folder ?? item.remoteItem?.folder;
				if (folder) {
					listing.folders.push(connectorFolder("onedrive", ctx.connection, {
						externalId: idOf(item),
						parentId: path.folderId,
						name: item.name ?? "",
						itemCount: folder.childCount ?? 0,
						modifiedAt: item.lastModifiedDateTime ?? null,
					}, now));
				} else {
					listing.entries.push(toAsset(item, path.folderId, now));
				}
			}
			return listing;
		},

		async metadata(id: string): Promise<AssetItem | null> {
			const item = await orNull(get<GraphItem>(`${itemPath(id)}?$select=${SELECT}`));
			if (!item || item.folder || item.remoteItem?.folder) return null;
			return toAsset(item, item.parentReference?.id ?? null, net.now().getTime());
		},

		async downloadUrl(id: string): Promise<string | null> {
			const item = await orNull(
				get<GraphItem>(`${itemPath(id)}?$select=id,@microsoft.graph.downloadUrl`),
			);
			return item?.["@microsoft.graph.downloadUrl"] ?? null;
		},

		async thumbnailUrl(id: string): Promise<string | null> {
			const sets = await orNull(get<{ value?: { medium?: { url?: string } }[] }>(
				`${itemPath(id)}/thumbnails?$select=medium`,
			));
			return sets?.value?.[0]?.medium?.url ?? null;
		},
	};
}
