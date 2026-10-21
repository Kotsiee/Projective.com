import type { AssetItem } from "@projective/types/files";
import { DropboxConnectionConfigSchema } from "@projective/types/integrations";
import {
	bearerOf,
	configOf,
	connectorAsset,
	connectorFolder,
	continuation,
	type ErrorClassifier,
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
 * DropboxAdapter — the `dropbox` connector, over the Dropbox API v2 RPC endpoints.
 *
 * - **List** — `POST /2/files/list_folder` (root is the empty path; a folder is addressed by its
 *   `id:` path), then `/list_folder/continue` with Dropbox's own cursor. `deleted` entries are skipped.
 * - **Team spaces** — `config.rootNamespaceId` is sent as `Dropbox-API-Path-Root`; without it a team
 *   member sees only their own folder, not the team space their work lives in.
 * - **Metadata** — `/2/files/get_metadata`. An endpoint-specific failure is a `409` whose
 *   `error_summary` says which; `…/not_found/…` is a missing object.
 * - **Download** — `/2/files/get_temporary_link`, a four-hour link Dropbox mints per call. A folder,
 *   an unverified account email or a non-downloadable file refuses with a `409`, which reads as "no
 *   link", not as a failure.
 * - **Thumbnail** — none as a URL: Dropbox serves thumbnails as bytes (`/files/get_thumbnail_v2`),
 *   which only a proxy route could hand a browser.
 * - **Web URL** — Dropbox returns none, so the hand-off is the documented `/home{path}` page.
 */

const API = "https://api.dropboxapi.com/2";
const PROVIDER = "Dropbox";

interface DropboxEntry {
	".tag": "file" | "folder" | "deleted";
	id?: string;
	name?: string;
	path_display?: string;
	size?: number;
	server_modified?: string;
	rev?: string;
}

interface DropboxPage {
	entries?: DropboxEntry[];
	cursor?: string;
	has_more?: boolean;
}

const classify: ErrorClassifier = (status, body) => {
	if (status === 409 && /not_found/.test(body)) return "not_found";
	if (status === 409) return "provider_error";
	return null;
};

/** The Dropbox web page an entry opens at: its folder, or its folder with the file previewed. */
function webUrlOf(entry: DropboxEntry): string | null {
	const path = entry.path_display;
	if (!path?.startsWith("/")) return null;
	const segments = path.split("/").slice(1).map(encodeURIComponent);
	const home = (parts: string[]) =>
		`https://www.dropbox.com/home${parts.map((p) => `/${p}`).join("")}`;
	if (entry[".tag"] === "folder") return home(segments);
	const name = segments.pop() ?? "";
	return `${home(segments)}?preview=${name}`;
}

/** Construct the Dropbox connector for one connection. */
export function createDropboxAdapter(ctx: StorageAdapterContext): StorageAdapter {
	const net = netOf(ctx);
	const config = configOf(DropboxConnectionConfigSchema, ctx.connection, PROVIDER);
	const headers: Record<string, string> = {
		authorization: `Bearer ${bearerOf(ctx, PROVIDER)}`,
		"content-type": "application/json",
	};
	if (config.rootNamespaceId) {
		headers["dropbox-api-path-root"] = JSON.stringify({
			".tag": "root",
			root: config.rootNamespaceId,
		});
	}

	function rpc<T>(endpoint: string, body: Record<string, unknown>): Promise<T> {
		return providerJson<T>(net, PROVIDER, `${API}${endpoint}`, {
			method: "POST",
			headers,
			body: JSON.stringify(body),
		}, classify);
	}

	function toAsset(
		entry: DropboxEntry & { id: string },
		parentId: string | null,
		now: number,
	): AssetItem {
		return connectorAsset("dropbox", ctx.connection, {
			externalId: entry.id,
			parentId,
			name: entry.name ?? "",
			mimeType: null,
			sizeBytes: entry.size ?? 0,
			modifiedAt: entry.server_modified ?? null,
			webUrl: webUrlOf(entry),
			etag: entry.rev ?? null,
		}, now);
	}

	return {
		slug: "dropbox",
		source: "dropbox",

		async list(path: DrivePath, cursor: string | null, limit: number): Promise<StorageListing> {
			const page = cursor
				? await rpc<DropboxPage>("/files/list_folder/continue", { cursor })
				: await rpc<DropboxPage>("/files/list_folder", {
					path: path.folderId ?? "",
					limit: pageSize(limit, 2000),
					include_deleted: false,
					include_mounted_folders: true,
					include_non_downloadable_files: true,
				});
			const now = net.now().getTime();
			const listing: StorageListing = {
				entries: [],
				folders: [],
				hasMore: page.has_more === true,
				nextCursor: page.has_more === true ? continuation(page.cursor, PROVIDER) : null,
			};
			for (const entry of page.entries ?? []) {
				if (!entry.id) continue;
				if (entry[".tag"] === "folder") {
					listing.folders.push(connectorFolder("dropbox", ctx.connection, {
						externalId: entry.id,
						parentId: path.folderId,
						name: entry.name ?? "",
						itemCount: 0,
						modifiedAt: null,
					}, now));
				} else if (entry[".tag"] === "file") {
					listing.entries.push(toAsset({ ...entry, id: entry.id }, path.folderId, now));
				}
			}
			return listing;
		},

		async metadata(id: string): Promise<AssetItem | null> {
			const entry = await orNull(
				rpc<DropboxEntry>("/files/get_metadata", { path: id, include_deleted: false }),
			);
			if (!entry?.id || entry[".tag"] !== "file") return null;
			return toAsset({ ...entry, id: entry.id }, null, net.now().getTime());
		},

		async downloadUrl(id: string): Promise<string | null> {
			try {
				const minted = await rpc<{ link?: string }>("/files/get_temporary_link", { path: id });
				return minted.link ?? null;
			} catch (error) {
				if (
					error instanceof StorageAdapterError &&
					(error.code === "not_found" || error.status === 409)
				) return null;
				throw error;
			}
		},

		thumbnailUrl(_id: string): Promise<string | null> {
			return Promise.resolve(null);
		},
	};
}
