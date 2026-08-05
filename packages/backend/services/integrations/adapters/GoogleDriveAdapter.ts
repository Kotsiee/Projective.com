import type { AssetItem } from "@projective/types/files";
import { isIntegrationsBackendLive } from "../../../core/supabase.ts";
import {
	type DrivePath,
	externalAsset,
	externalFolder,
	hash,
	type StorageAdapter,
	type StorageAdapterContext,
	type StorageListing,
} from "./StorageAdapter.ts";

/**
 * GoogleDriveAdapter — the `google_drive` storage connector.
 *
 * ### The live API surface
 *
 * * **List** — `GET https://www.googleapis.com/drive/v3/files` with
 *   `q="{folderId}" in parents and trashed = false`, `pageSize`, `pageToken`, and an explicit
 *   `fields=nextPageToken,files(id,name,mimeType,size,parents,modifiedTime,webViewLink,thumbnailLink,md5Checksum)`.
 *   The `fields` mask is not an optimisation — Drive returns a minimal projection by default, so
 *   omitting it silently drops `size` and every row lists as 0 bytes.
 * * **Metadata** — `GET /drive/v3/files/{fileId}` with the same mask.
 * * **Download** — `GET /drive/v3/files/{fileId}?alt=media` for binary files; a Google-native Doc has
 *   **no bytes at all** and must go through `/export?mimeType=…` instead. That branch is mandatory: a
 *   naive `alt=media` on a Doc returns a 403 the user reads as "broken".
 * * **Thumbnail** — `thumbnailLink` from the list response. It expires in hours and is
 *   credential-bearing, so it is re-fetched per call and never persisted onto a row.
 * * **Shared drives** — pass `supportsAllDrives=true` and `includeItemsFromAllDrives=true`, plus
 *   `driveId` + `corpora=drive` when the connection's `config.driveId` is set. Without them a user who
 *   works entirely in a shared drive sees an empty connector and reports it as broken.
 * * **Delta sync** — `GET /drive/v3/changes` against a `startPageToken`. The page token is the sync
 *   cursor stored on `integrations.connection_sync_state`, never a timestamp: Drive orders changes by
 *   token, and a clock-based cursor loses every edit that lands during the same second.
 * * **Webhooks** — `POST /drive/v3/files/{id}/watch` registers a channel that **expires**, which is why
 *   `integrations.webhook_subscriptions.expires_at` is first-class and a cron renews it. An unrenewed
 *   channel stops delivering silently; nothing errors, the data simply goes stale.
 *
 * Stub-first behind {@link isIntegrationsBackendLive}: the corpus below is deterministic and no request
 * leaves the process until the gate flips.
 */
export function createGoogleDriveAdapter(ctx: StorageAdapterContext): StorageAdapter {
	const { connection } = ctx;

	/** The stub corpus: a root with two folders, and a handful of files in each level. */
	function corpus(folderId: string | null): StorageListing {
		const parent = folderId ?? "root";
		const seed = hash(`gdrive:${connection.id}:${parent}`);

		const folders = parent === "root"
			? [
				externalFolder({
					connection,
					source: "google_drive",
					externalFolderId: "gd-fld-clients",
					name: "Clients",
					parentId: null,
					itemCount: 6,
				}),
				externalFolder({
					connection,
					source: "google_drive",
					externalFolderId: "gd-fld-admin",
					name: "Admin",
					parentId: null,
					itemCount: 3,
				}),
			]
			: [];

		const names = parent === "gd-fld-clients"
			? ["Northwind SOW.docx", "Atlas kickoff.pdf", "Budget tracker.xlsx"]
			: parent === "gd-fld-admin"
			? ["Insurance certificate.pdf", "Company registration.pdf"]
			: ["Q3 strategy deck.pdf", "Content calendar.xlsx", "Team offsite.jpg", "Retro notes.docx"];

		const entries: AssetItem[] = names.map((name, index) =>
			externalAsset({
				connection,
				source: "google_drive",
				externalFileId: `gd-${parent}-${index}`,
				externalParentId: folderId,
				name,
				sizeBytes: 90_000 + ((seed + index * 977) % 4_000_000),
				agoHours: 6 + ((seed + index * 13) % 400),
				webUrl: `https://drive.google.com/file/d/gd-${parent}-${index}/view`,
				folderId: folderId ? `google_drive:${folderId}` : null,
			})
		);

		return { entries, folders, hasMore: false, nextCursor: null };
	}

	/** One object from the stub corpus, addressed by the provider's own file id. */
	function fromCorpus(id: string): AssetItem | null {
		return corpus(null).entries.find((e) => e.external?.externalFileId === id) ?? null;
	}

	return {
		slug: "google_drive",
		source: "google_drive",

		list(path: DrivePath, _cursor: string | null, limit: number): Promise<StorageListing> {
			if (!isIntegrationsBackendLive()) {
				const page = corpus(path.folderId ?? null);
				return Promise.resolve({ ...page, entries: page.entries.slice(0, limit) });
			}
			// LIVE: `files.list` with the `q`/`fields`/`pageToken` documented above, echoing Drive's
			// `nextPageToken` back as `nextCursor`. Not yet implemented; fall back to the stub corpus.
			const page = corpus(path.folderId ?? null);
			return Promise.resolve({ ...page, entries: page.entries.slice(0, limit) });
		},

		metadata(id: string): Promise<AssetItem | null> {
			if (!isIntegrationsBackendLive()) return Promise.resolve(fromCorpus(id));
			// LIVE: `GET /drive/v3/files/{fileId}` with the SAME `fields` mask as the listing — omitting
			// it returns a minimal projection whose `size` is absent, so a row imported through this
			// path would be stored as 0 bytes. Not yet implemented; fall back to the stub corpus.
			return Promise.resolve(fromCorpus(id));
		},

		downloadUrl(id: string): Promise<string | null> {
			// Short-lived and minted per call — never cached onto a row (see the StorageAdapter note).
			if (!isIntegrationsBackendLive()) return Promise.resolve(null);
			return Promise.resolve(`https://www.googleapis.com/drive/v3/files/${id}?alt=media`);
		},

		thumbnailUrl(id: string): Promise<string | null> {
			if (!isIntegrationsBackendLive()) return Promise.resolve(null);
			// LIVE: the `thumbnailLink` from the file's `fields` mask. It expires in hours and is
			// credential-bearing, so it is re-read per call and never persisted onto a row. Not yet
			// implemented.
			void id;
			return Promise.resolve(null);
		},
	};
}
