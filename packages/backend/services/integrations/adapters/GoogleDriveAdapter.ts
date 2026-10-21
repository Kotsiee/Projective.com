import type { AssetItem } from "@projective/types/files";
import { GoogleDriveConnectionConfigSchema } from "@projective/types/integrations";
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
import type {
	DrivePath,
	StorageAdapter,
	StorageAdapterContext,
	StorageListing,
} from "./StorageAdapter.ts";

/**
 * GoogleDriveAdapter — the `google_drive` connector, over the Drive v3 REST API.
 *
 * - **List** — `GET /drive/v3/files` with `q='{parent}' in parents and trashed = false` and an explicit
 *   `fields` mask: Drive's default projection omits `size`, and a row listed without it reads 0 bytes.
 * - **Shared drives** — `supportsAllDrives=true` on every call, plus `corpora=drive&driveId=…` when the
 *   connection's `config.driveId` names one; without them a person who works entirely in a shared drive
 *   sees an empty connector.
 * - **Shortcuts** resolve to their target, so a shortcut to a folder browses as that folder.
 * - **Google-native documents** have no bytes and no size; they classify by their export family (a
 *   Doc is a Document) and download as their PDF export.
 * - **Download** — Drive mints no pre-signed URL for a private file, so this hands off `webContentLink`,
 *   which downloads under the viewer's own Google session and carries no credential.
 * - **Thumbnail** — `thumbnailLink`, short-lived and credential-bearing, so read per call only.
 */

const API = "https://www.googleapis.com/drive/v3";
const PROVIDER = "Google Drive";
const FOLDER = "application/vnd.google-apps.folder";
const SHORTCUT = "application/vnd.google-apps.shortcut";
const NATIVE = "application/vnd.google-apps.";
const FILE_FIELDS = "id,name,mimeType,size,parents,modifiedTime,webViewLink,version," +
	"imageMediaMetadata(width,height),videoMediaMetadata(width,height,durationMillis)," +
	"shortcutDetails(targetId,targetMimeType)";

/** The export family each Google-native type classifies as. */
const NATIVE_AS: Readonly<Record<string, string>> = {
	document: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
	spreadsheet: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
	presentation: "application/vnd.openxmlformats-officedocument.presentationml.presentation",
	drawing: "image/svg+xml",
};

interface DriveFile {
	id: string;
	name?: string;
	mimeType?: string;
	size?: string;
	parents?: string[];
	modifiedTime?: string;
	webViewLink?: string;
	version?: string;
	imageMediaMetadata?: { width?: number; height?: number };
	videoMediaMetadata?: { width?: number; height?: number; durationMillis?: string };
	shortcutDetails?: { targetId?: string; targetMimeType?: string };
	webContentLink?: string;
	exportLinks?: Record<string, string>;
	hasThumbnail?: boolean;
	thumbnailLink?: string;
}

/** A Drive query string literal: `\` and `'` escaped, per the `q` grammar. */
function quoted(value: string): string {
	return `'${value.replaceAll("\\", "\\\\").replaceAll("'", "\\'")}'`;
}

/** Construct the Google Drive connector for one connection. */
export function createGoogleDriveAdapter(ctx: StorageAdapterContext): StorageAdapter {
	const net = netOf(ctx);
	const config = configOf(GoogleDriveConnectionConfigSchema, ctx.connection, PROVIDER);
	const token = bearerOf(ctx, PROVIDER);
	const headers = { authorization: `Bearer ${token}`, accept: "application/json" };

	function get<T>(path: string, params: Record<string, string>): Promise<T> {
		const query = new URLSearchParams({ ...params, supportsAllDrives: "true" });
		return providerJson<T>(net, PROVIDER, `${API}${path}?${query}`, { headers });
	}

	function target(file: DriveFile): { id: string; mimeType: string } {
		if (file.mimeType === SHORTCUT && file.shortcutDetails?.targetId) {
			return {
				id: file.shortcutDetails.targetId,
				mimeType: file.shortcutDetails.targetMimeType ?? "",
			};
		}
		return { id: file.id, mimeType: file.mimeType ?? "" };
	}

	function toAsset(file: DriveFile, now: number): AssetItem {
		const resolved = target(file);
		const native = resolved.mimeType.startsWith(NATIVE);
		const media = file.videoMediaMetadata ?? file.imageMediaMetadata;
		return connectorAsset("google_drive", ctx.connection, {
			externalId: resolved.id,
			parentId: file.parents?.[0] ?? null,
			name: file.name ?? "",
			mimeType: native
				? NATIVE_AS[resolved.mimeType.slice(NATIVE.length)] ?? null
				: resolved.mimeType || null,
			sizeBytes: Number(file.size ?? 0),
			modifiedAt: file.modifiedTime ?? null,
			webUrl: file.webViewLink ?? null,
			etag: file.version ?? null,
			width: media?.width ?? null,
			height: media?.height ?? null,
			durationMs: Number(file.videoMediaMetadata?.durationMillis ?? 0),
		}, now);
	}

	return {
		slug: "google_drive",
		source: "google_drive",

		async list(path: DrivePath, cursor: string | null, limit: number): Promise<StorageListing> {
			const parent = path.folderId ?? config.driveId ?? "root";
			const params: Record<string, string> = {
				q: `${quoted(parent)} in parents and trashed = false`,
				fields: `nextPageToken,files(${FILE_FIELDS})`,
				pageSize: String(pageSize(limit, 1000)),
				orderBy: "folder,name_natural",
			};
			if (cursor) params.pageToken = cursor;
			if (config.driveId) {
				params.corpora = "drive";
				params.driveId = config.driveId;
				params.includeItemsFromAllDrives = "true";
			}
			const page = await get<{ nextPageToken?: string; files?: DriveFile[] }>("/files", params);
			const now = net.now().getTime();
			const listing: StorageListing = {
				entries: [],
				folders: [],
				hasMore: Boolean(page.nextPageToken),
				nextCursor: continuation(page.nextPageToken, PROVIDER),
			};
			for (const file of page.files ?? []) {
				const resolved = target(file);
				if (resolved.mimeType === FOLDER) {
					listing.folders.push(connectorFolder("google_drive", ctx.connection, {
						externalId: resolved.id,
						parentId: path.folderId,
						name: file.name ?? "",
						itemCount: 0,
						modifiedAt: file.modifiedTime ?? null,
					}, now));
				} else {
					listing.entries.push(toAsset(file, now));
				}
			}
			return listing;
		},

		async metadata(id: string): Promise<AssetItem | null> {
			const file = await orNull(
				get<DriveFile>(`/files/${encodeURIComponent(id)}`, { fields: FILE_FIELDS }),
			);
			if (!file || target(file).mimeType === FOLDER) return null;
			return toAsset(file, net.now().getTime());
		},

		async downloadUrl(id: string): Promise<string | null> {
			const file = await orNull(get<DriveFile>(`/files/${encodeURIComponent(id)}`, {
				fields: "id,mimeType,webContentLink,exportLinks",
			}));
			if (!file || file.mimeType === FOLDER) return null;
			if (file.mimeType?.startsWith(NATIVE)) return file.exportLinks?.["application/pdf"] ?? null;
			return file.webContentLink ?? null;
		},

		async thumbnailUrl(id: string): Promise<string | null> {
			const file = await orNull(get<DriveFile>(`/files/${encodeURIComponent(id)}`, {
				fields: "hasThumbnail,thumbnailLink",
			}));
			return file?.hasThumbnail && file.thumbnailLink ? file.thumbnailLink : null;
		},
	};
}
