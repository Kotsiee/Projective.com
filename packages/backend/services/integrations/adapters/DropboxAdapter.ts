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
 * DropboxAdapter — the `dropbox` storage connector.
 *
 * ### The live API surface
 *
 * * **List** — `POST https://api.dropboxapi.com/2/files/list_folder` with
 *   `{ path, limit, include_media_info: true }`, then `list_folder/continue` with the returned
 *   `cursor` until `has_more` is false. Dropbox addresses by **path**, not by id, and the ROOT is the
 *   empty string `""` — not `"/"`, which is an error. That single detail is the most common way this
 *   integration is first written wrong.
 * * **Metadata** — `POST /2/files/get_metadata` with `{ path }`. A `.tag` of `folder` and one of `file`
 *   come back in the same array from `list_folder`, so the discriminant must be read rather than
 *   inferred from the presence of `size`.
 * * **Download** — `POST /2/files/get_temporary_link`, which returns a URL valid for ~4 hours. Never
 *   persisted onto a row.
 * * **Thumbnail** — `POST /2/files/get_thumbnail_v2` (content endpoint) for image and PDF types only.
 * * **Delta sync** — the SAME `cursor` from `list_folder` is the long-poll cursor for
 *   `/2/files/list_folder/longpoll`. One token serves paging and change detection, which is why the
 *   adapter contract echoes the provider's cursor verbatim instead of normalising it.
 * * **Webhooks** — an app-level webhook fires with a **list of user ids and no payload**; the adapter
 *   must then poll `list_folder/continue` per user. A design that expects the change in the webhook
 *   body will silently do nothing.
 *
 * Stub-first behind {@link isIntegrationsBackendLive}.
 */
export function createDropboxAdapter(ctx: StorageAdapterContext): StorageAdapter {
	const { connection } = ctx;

	/** The stub corpus. Keyed on the PATH, mirroring how Dropbox actually addresses a location. */
	function corpus(path: string | null): StorageListing {
		// The Dropbox root is the empty string. `"/"` is an error at the real API, so the stub models
		// the same convention rather than a friendlier one that would hide the bug until go-live.
		const key = path ?? "";
		const seed = hash(`dropbox:${connection.id}:${key}`);

		const folders = key === ""
			? [
				externalFolder({
					connection,
					source: "dropbox",
					externalFolderId: "/Shared with clients",
					name: "Shared with clients",
					parentId: null,
					itemCount: 4,
				}),
			]
			: [];

		const names = key === "/Shared with clients"
			? ["Handover pack.zip", "Final logos.zip"]
			: ["Client photos.zip", "Site backup.zip", "Reference board.png"];

		const entries: AssetItem[] = names.map((name, index) =>
			externalAsset({
				connection,
				source: "dropbox",
				externalFileId: `${key}/${name}`,
				externalParentId: key || null,
				name,
				sizeBytes: 1_200_000 + ((seed + index * 613) % 90_000_000),
				agoHours: 20 + ((seed + index * 29) % 900),
				webUrl: `https://www.dropbox.com/home${encodeURI(key)}?preview=${encodeURIComponent(name)}`,
				folderId: key ? `dropbox:${key}` : null,
			})
		);

		return { entries, folders, hasMore: false, nextCursor: null };
	}

	/** One object from the stub corpus, addressed by the path Dropbox uses as its id. */
	function fromCorpus(id: string): AssetItem | null {
		return corpus(null).entries.find((e) => e.external?.externalFileId === id) ?? null;
	}

	return {
		slug: "dropbox",
		source: "dropbox",

		list(path: DrivePath, _cursor: string | null, limit: number): Promise<StorageListing> {
			// Dropbox has no folder ids: a `folderId` arriving from the hub IS a path, so both inputs
			// collapse to one here rather than being resolved through a lookup that does not exist.
			const key = path.path ?? path.folderId ?? "";
			if (!isIntegrationsBackendLive()) {
				const page = corpus(key);
				return Promise.resolve({ ...page, entries: page.entries.slice(0, limit) });
			}
			// LIVE: `list_folder` / `list_folder/continue`, echoing Dropbox's `cursor` as `nextCursor`.
			// Not yet implemented; fall back to the stub corpus.
			const page = corpus(key);
			return Promise.resolve({ ...page, entries: page.entries.slice(0, limit) });
		},

		metadata(id: string): Promise<AssetItem | null> {
			if (!isIntegrationsBackendLive()) return Promise.resolve(fromCorpus(id));
			// LIVE: `POST /2/files/get_metadata` with `{ path }` — Dropbox addresses by path, so the id
			// IS the path and needs no lookup. Not yet implemented; fall back to the stub corpus.
			return Promise.resolve(fromCorpus(id));
		},

		downloadUrl(id: string): Promise<string | null> {
			if (!isIntegrationsBackendLive()) return Promise.resolve(null);
			// LIVE: `get_temporary_link` — ~4 hours, minted per call, never cached onto a row.
			void id;
			return Promise.resolve(null);
		},

		thumbnailUrl(id: string): Promise<string | null> {
			if (!isIntegrationsBackendLive()) return Promise.resolve(null);
			// LIVE: `POST /2/files/get_thumbnail_v2`, which returns BYTES rather than a URL — so the live
			// branch has to stream them into our own short-lived object and hand that back, never a
			// Dropbox URL. Not yet implemented.
			void id;
			return Promise.resolve(null);
		},
	};
}
