import type { AssetItem } from "@projective/types/files";
import type { S3ConnectionConfig } from "@projective/types/integrations";
import { S3ConnectionConfigSchema } from "@projective/types/integrations";
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
 * S3Adapter — the `s3` connector, for AWS S3 and every S3-compatible server (R2, MinIO, Wasabi).
 *
 * **S3 is the one storage connector with no authorization server.** There is no consent screen, no
 * redirect and no refresh — the user supplies a key pair (or an assumable role) that the platform signs
 * every request with. That is why `auth_scheme` carries a distinct `aws_sigv4` member: the connect flow
 * must branch on it rather than pretending a credential form is a consent screen.
 *
 * **There are no folders.** S3 has a flat keyspace; "folders" are a `delimiter` convention over shared
 * key prefixes. So a listing must read BOTH `Contents` (the objects) and `CommonPrefixes` (the synthetic
 * directories), and a prefix that has never had an object under it does not exist at all — which is why
 * {@link DrivePath} carries `path` alongside `folderId` instead of forcing one into the other.
 *
 * ### The live API surface
 *
 * * **List** — `GET /?list-type=2&prefix={prefix}&delimiter=/&max-keys={limit}` plus
 *   `continuation-token`. `IsTruncated` + `NextContinuationToken` drive paging; the token is opaque and
 *   echoed back verbatim.
 * * **Metadata** — `HEAD /{key}` for `Content-Length`, `Content-Type`, `ETag` and `Last-Modified`.
 *   **`ETag` is only an MD5 for a single-part upload** — a multipart object's ETag ends in `-N` and is a
 *   digest of digests. Treating it as a content hash would make dedup silently wrong for exactly the
 *   large files dedup exists for.
 * * **Download** — a SigV4 pre-signed `GET`, expiry capped at 7 days by the protocol. Minted per call.
 * * **Thumbnail** — none. S3 stores bytes and has no derivative pipeline, so previews come from our own
 *   side or not at all.
 * * **Path-style addressing** — most self-hosted S3-compatible servers require
 *   `endpoint/bucket/key` rather than `bucket.endpoint/key`, because the virtual-host form has no DNS
 *   to resolve. The connection's `config.pathStyle` decides, and getting it wrong produces a DNS error
 *   that reads as "your bucket does not exist".
 * * **Delta sync** — no changes feed. Either poll `LastModified` or have the bucket emit S3 Event
 *   Notifications to a queue; the second is the only one that scales past a few thousand objects.
 *
 * ⚠️ The access key and secret are NEVER on the connection row. They live in
 * `integrations.connection_secrets` (service-role only, no policy, no view) and are read through
 * `../token-vault.ts`. `config` carries only the non-secret addressing — endpoint, region, bucket,
 * prefix, path-style.
 *
 * Stub-first behind {@link isIntegrationsBackendLive}.
 */
export function createS3Adapter(ctx: StorageAdapterContext): StorageAdapter {
	const { connection } = ctx;

	/**
	 * Parse the connection's addressing.
	 *
	 * Parsed against the provider's OWN schema rather than trusting the generic scalar record on the
	 * connection row: a second provider's config would otherwise have to satisfy S3's keys.
	 */
	function config(): S3ConnectionConfig | null {
		const parsed = S3ConnectionConfigSchema.safeParse(connection.config ?? {});
		return parsed.success ? parsed.data : null;
	}

	/** The stub corpus, keyed on the key PREFIX — the only way S3 addresses a location. */
	function corpus(prefix: string): StorageListing {
		const seed = hash(`s3:${connection.id}:${prefix}`);

		// `CommonPrefixes` — the synthetic directories a delimiter produces. They are not objects and
		// have no size, no timestamp and no owner of their own.
		const folders = prefix === ""
			? [
				externalFolder({
					connection,
					source: "s3",
					externalFolderId: "renders/",
					name: "renders",
					parentId: null,
					itemCount: 5,
				}),
				externalFolder({
					connection,
					source: "s3",
					externalFolderId: "archive/",
					name: "archive",
					parentId: null,
					itemCount: 12,
				}),
			]
			: [];

		const names = prefix === "renders/"
			? ["master-render-4k.mov", "master-render-1080.mp4"]
			: prefix === "archive/"
			? ["2025-masters.tar", "2024-masters.tar"]
			: ["site-assets.zip", "delivery-manifest.json"];

		const entries: AssetItem[] = names.map((name, index) =>
			externalAsset({
				connection,
				source: "s3",
				externalFileId: `${prefix}${name}`,
				externalParentId: prefix || null,
				name,
				sizeBytes: 300_000_000 + ((seed + index * 4001) % 2_000_000_000),
				agoHours: 60 + ((seed + index * 41) % 3000),
				// A bucket object has no web UI to hand off to, so the console URL is the honest link.
				webUrl: `https://s3.console.aws.amazon.com/s3/object/${
					config()?.bucket ?? "bucket"
				}?prefix=${encodeURIComponent(prefix + name)}`,
				folderId: prefix ? `s3:${prefix}` : null,
			})
		);

		return { entries, folders, hasMore: false, nextCursor: null };
	}

	/** One object from the stub corpus, addressed by its full key. */
	function fromCorpus(id: string): AssetItem | null {
		return corpus("").entries.find((e) => e.external?.externalFileId === id) ?? null;
	}

	return {
		slug: "s3",
		source: "s3",

		list(path: DrivePath, _cursor: string | null, limit: number): Promise<StorageListing> {
			// A `folderId` arriving from the hub IS a prefix — S3 has no folder objects to resolve one
			// against, so both inputs collapse here rather than through a lookup that cannot exist.
			const prefix = path.path ?? path.folderId ?? "";
			if (!isIntegrationsBackendLive()) {
				const page = corpus(prefix);
				return Promise.resolve({ ...page, entries: page.entries.slice(0, limit) });
			}
			// LIVE: `ListObjectsV2` with `prefix` + `delimiter=/` + `continuation-token`, reading BOTH
			// `Contents` and `CommonPrefixes`. Not yet implemented; fall back to the stub corpus.
			const page = corpus(prefix);
			return Promise.resolve({ ...page, entries: page.entries.slice(0, limit) });
		},

		metadata(id: string): Promise<AssetItem | null> {
			if (!isIntegrationsBackendLive()) return Promise.resolve(fromCorpus(id));
			// LIVE: a SigV4 `HeadObject` on the key — S3 has no metadata endpoint distinct from the
			// object itself, and `HeadObject` is the read that costs no bytes. Not yet implemented;
			// fall back to the stub corpus.
			return Promise.resolve(fromCorpus(id));
		},

		downloadUrl(id: string): Promise<string | null> {
			if (!isIntegrationsBackendLive()) return Promise.resolve(null);
			// LIVE: a SigV4 pre-signed GET (≤ 7 days by protocol), minted per call, never cached.
			void id;
			return Promise.resolve(null);
		},

		/**
		 * S3 stores bytes and has no derivative pipeline — there is no thumbnail to offer.
		 *
		 * The gate fork is here anyway, and the LIVE branch answers `null` too: a bucket that happens to
		 * hold a `_thumbs/` convention is one customer's filing habit, not an S3 capability, and reading
		 * it would make the connector behave differently for two buckets that are identically configured.
		 */
		thumbnailUrl(id: string): Promise<string | null> {
			if (!isIntegrationsBackendLive()) return Promise.resolve(null);
			void id;
			return Promise.resolve(null);
		},
	};
}
