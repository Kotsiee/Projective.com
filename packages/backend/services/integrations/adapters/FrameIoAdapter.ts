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
 * FrameIoAdapter — the `frameio` storage connector, for video review workflows.
 *
 * ### The live API surface
 *
 * * **List** — `GET https://api.frame.io/v2/assets/{parentAssetId}/children` with `page` +
 *   `page_size`. Frame.io's hierarchy is `Team → Project → root_asset_id → children`, so the ROOT of a
 *   connection is a project's `root_asset_id` and not the project id: browsing from the project id
 *   returns nothing, with no error to explain why.
 * * **Metadata** — `GET /v2/assets/{assetId}`. The `type` field discriminates `folder` · `file` ·
 *   **`version_stack`**, and the third is the one that matters here: a version stack is a container
 *   whose children are successive cuts of the same shot. Flattening it into a folder shows five files
 *   named identically; treating it as a file hides every version but the newest. It is projected as a
 *   FOLDER whose name carries the version count, so both facts survive.
 * * **Download** — the asset's `original` field is a pre-signed S3 URL that **expires in ~24 hours**.
 *   Re-read per call.
 * * **Thumbnail** — `cover_asset` / the `thumb` derivative from the asset payload.
 * * **Delta sync** — no changes feed. Reconciliation is by `updated_at` per folder, which is why this
 *   connector is inbound-only and polls rather than syncing continuously.
 * * **Webhooks** — team-scoped, subscribed by event type (`asset.ready`, `comment.created`). Frame.io
 *   signs each delivery; the signature must be verified before the payload is read, and the delivery id
 *   deduped through `integrations.webhook_deliveries` — retries are guaranteed, not exceptional.
 *
 * Stub-first behind {@link isIntegrationsBackendLive}.
 */
export function createFrameIoAdapter(ctx: StorageAdapterContext): StorageAdapter {
	const { connection } = ctx;

	/** The stub corpus: a project root holding a version stack and two loose cuts. */
	function corpus(assetId: string | null): StorageListing {
		const parent = assetId ?? "root";
		const seed = hash(`frameio:${connection.id}:${parent}`);

		const folders = parent === "root"
			? [
				externalFolder({
					connection,
					source: "frameio",
					externalFolderId: "fio-stack-launch",
					// A version stack, projected as a folder with the count in its name — see the note.
					name: "Launch film (4 versions)",
					parentId: null,
					itemCount: 4,
				}),
			]
			: [];

		const names = parent === "fio-stack-launch"
			? [
				"Launch film — v1.mp4",
				"Launch film — v2.mp4",
				"Launch film — v3.mp4",
				"Launch film — v4.mp4",
			]
			: ["Teaser cut.mp4", "Behind the scenes.mov"];

		const entries: AssetItem[] = names.map((name, index) =>
			externalAsset({
				connection,
				source: "frameio",
				externalFileId: `fio-${parent}-${index}`,
				externalParentId: assetId,
				name,
				sizeBytes: 40_000_000 + ((seed + index * 7919) % 900_000_000),
				agoHours: 4 + ((seed + index * 17) % 300),
				webUrl: `https://app.frame.io/presentations/fio-${parent}-${index}`,
				folderId: assetId ? `frameio:${assetId}` : null,
			})
		);

		return { entries, folders, hasMore: false, nextCursor: null };
	}

	/** One asset from the stub corpus, addressed by its Frame.io asset id. */
	function fromCorpus(id: string): AssetItem | null {
		return corpus(null).entries.find((e) => e.external?.externalFileId === id) ?? null;
	}

	return {
		slug: "frameio",
		source: "frameio",

		list(path: DrivePath, _cursor: string | null, limit: number): Promise<StorageListing> {
			if (!isIntegrationsBackendLive()) {
				const page = corpus(path.folderId ?? null);
				return Promise.resolve({ ...page, entries: page.entries.slice(0, limit) });
			}
			// LIVE: `/v2/assets/{id}/children` paged by `page`/`page_size`, rooted at the connection's
			// `config.rootAssetId`. Not yet implemented; fall back to the stub corpus.
			const page = corpus(path.folderId ?? null);
			return Promise.resolve({ ...page, entries: page.entries.slice(0, limit) });
		},

		metadata(id: string): Promise<AssetItem | null> {
			if (!isIntegrationsBackendLive()) return Promise.resolve(fromCorpus(id));
			// LIVE: `GET /v2/assets/{id}`. A Frame.io asset carries VERSIONS, so the live branch must
			// answer for the version the caller addressed rather than the version stack's head —
			// importing "the latest cut" is how a reviewer ends up approving a file nobody chose. Not
			// yet implemented; fall back to the stub corpus.
			return Promise.resolve(fromCorpus(id));
		},

		downloadUrl(id: string): Promise<string | null> {
			if (!isIntegrationsBackendLive()) return Promise.resolve(null);
			// LIVE: the asset's `original` pre-signed URL, ~24h, re-read per call.
			void id;
			return Promise.resolve(null);
		},

		thumbnailUrl(id: string): Promise<string | null> {
			if (!isIntegrationsBackendLive()) return Promise.resolve(null);
			// LIVE: the asset's `cover_asset`/`thumb` derivative, which is pre-signed and short-lived —
			// re-read per call and never persisted onto a row. Not yet implemented.
			void id;
			return Promise.resolve(null);
		},
	};
}
