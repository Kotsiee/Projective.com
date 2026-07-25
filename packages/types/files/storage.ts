import { z } from "zod";

/**
 * files.storage — the Zod SSOT for the Supabase Storage layout.
 *
 * One typed map of every bucket, its access tier / size / MIME limits, and the path conventions the
 * RLS policies key on. This is the single source of truth the app, the `@projective/backend`
 * services, and any upload/download helper share, so no code hardcodes a bucket id or hand-builds a
 * path that can drift from the database. It mirrors — and must stay in lockstep with — the two
 * migrations and the doc:
 *   - `supabase/migrations/00005040_seed_storage_buckets.sql`  (bucket seed: ids, limits, MIME)
 *   - `supabase/migrations/00002017_policies_storage.sql`      (per-bucket RLS contract)
 *   - `documentation/database/files/Storage.md`                (the human-readable architecture)
 *
 * THE INVARIANT: the first path segment of every object is the RLS anchor
 * (`(storage.foldername(name))[1]` in the policies). The builders below always emit that anchor
 * first, so a path produced here is guaranteed to satisfy the matching policy's `WITH CHECK`.
 *
 * Only enum/primitive Zod is used so the module is stable across Zod majors (matching
 * `newsletter/subscribe.ts`, `explore/items.ts`).
 */

// #region Buckets

/** Every storage bucket id, matching the `00005040` seed exactly. */
export const StorageBucket = z.enum([
	"quarantine",
	"project",
	"messages",
	"personal",
	"invoices",
	"verification",
	"public_assets",
	"avatars",
	"catalogue",
]);
export type StorageBucket = z.infer<typeof StorageBucket>;

/**
 * Access tier of a bucket.
 * - `public`  — object URLs are edge-cached and world-readable (write still owner-scoped).
 * - `private` — read via short-lived signed URLs; RLS governs read + write.
 * - `service` — service-role ONLY; no `authenticated` policy exists (KYC/KYB).
 */
export const StorageAccess = z.enum(["public", "private", "service"]);
export type StorageAccess = z.infer<typeof StorageAccess>;

const MiB = 1024 * 1024;

/** Common image MIME set for branding / storefront media. */
const IMAGE_MIME = [
	"image/png",
	"image/jpeg",
	"image/webp",
	"image/gif",
] as const;

/** Static description of one bucket — kept identical to the seed migration. */
export interface BucketMeta {
	/** Access tier governing read visibility. */
	readonly access: StorageAccess;
	/** Per-bucket max object size in bytes (the seed's `file_size_limit`). */
	readonly maxBytes: number;
	/** Allowed MIME types, or `null` for "any" (the seed's `allowed_mime_types`). */
	readonly allowedMime: readonly string[] | null;
	/** What the first path segment (`(storage.foldername(name))[1]`) means for this bucket. */
	readonly anchor: string;
	/** One-line purpose, mirroring `Storage.md`. */
	readonly purpose: string;
}

/**
 * The authoritative bucket registry. Reads should go through {@link bucketMeta}; this record is the
 * data behind it and the thing to diff against `00005040` if the two ever look out of sync.
 */
export const BUCKETS: Readonly<Record<StorageBucket, BucketMeta>> = {
	quarantine: {
		access: "private",
		maxBytes: 50 * MiB,
		allowedMime: null,
		anchor: "user_id",
		purpose: "Virus-scan / MIME-validation landing zone for all uploads.",
	},
	project: {
		access: "private",
		maxBytes: 50 * MiB,
		allowedMime: null,
		anchor: "project_id",
		purpose: "Project / channel / stage collaboration files.",
	},
	messages: {
		access: "private",
		maxBytes: 50 * MiB,
		allowedMime: null,
		anchor: "thread_id",
		purpose: "Global DM / inbox attachments (not project-scoped).",
	},
	personal: {
		access: "private",
		maxBytes: 50 * MiB,
		allowedMime: null,
		anchor: "user_id",
		purpose: "Owner-only drive: drafts, personal templates, work-in-progress.",
	},
	invoices: {
		access: "private",
		maxBytes: 20 * MiB,
		allowedMime: ["application/pdf"],
		anchor: "owner_id",
		purpose: "Wallet statements / invoices / receipts.",
	},
	verification: {
		access: "service",
		maxBytes: 20 * MiB,
		allowedMime: ["image/png", "image/jpeg", "image/webp", "application/pdf"],
		anchor: "subject_id",
		purpose: "KYC / KYB identity documents — service-role only.",
	},
	public_assets: {
		access: "public",
		maxBytes: 10 * MiB,
		allowedMime: [...IMAGE_MIME, "image/svg+xml"],
		anchor: "owner_id",
		purpose: "Misc public assets (general / legacy).",
	},
	avatars: {
		access: "public",
		maxBytes: 5 * MiB,
		allowedMime: [...IMAGE_MIME],
		anchor: "entity_id",
		purpose: "Profile / team / business / org branding.",
	},
	catalogue: {
		access: "public",
		maxBytes: 10 * MiB,
		allowedMime: [...IMAGE_MIME],
		anchor: "seller_id",
		purpose: "Marketplace storefront media (products, service showcase).",
	},
};

/** Typed accessor for a bucket's metadata. */
export function bucketMeta(bucket: StorageBucket): BucketMeta {
	return BUCKETS[bucket];
}

// #endregion

// #region Location shape + helpers

/** A resolved storage location: the bucket plus the object path WITHIN it (no leading slash). */
export interface StorageLocation {
	readonly bucket: StorageBucket;
	/** Object path relative to the bucket — its first segment is the RLS anchor. */
	readonly path: string;
}

/** The branding entity kinds that own an `avatars/` prefix. */
export const AvatarEntity = z.enum([
	"users",
	"teams",
	"businesses",
	"organisations",
]);
export type AvatarEntity = z.infer<typeof AvatarEntity>;

/** Join path segments into a bucket-relative object path (drops empty segments, trims slashes). */
function join(...segments: Array<string | number>): string {
	return segments
		.map((s) => String(s).replace(/^\/+|\/+$/g, ""))
		.filter((s) => s.length > 0)
		.join("/");
}

/**
 * The RLS anchor of an object path — the first path segment the storage policies check via
 * `(storage.foldername(name))[1]`. Returns `null` for an empty/rootless path.
 */
export function rlsAnchor(path: string): string | null {
	return join(path).split("/")[0] || null;
}

// #endregion

// #region Path builders — each emits the RLS anchor first, matching Storage.md

/** `quarantine/{userId}/{uploadSessionId}/{filename}` — the mandatory upload entry point. */
export function quarantineLocation(
	userId: string,
	uploadSessionId: string,
	filename: string,
): StorageLocation {
	return { bucket: "quarantine", path: join(userId, uploadSessionId, filename) };
}

/** `project/{projectId}/...segments` — gated by `projects.has_project_access(projectId)`. */
export function projectLocation(
	projectId: string,
	...segments: Array<string | number>
): StorageLocation {
	return { bucket: "project", path: join(projectId, ...segments) };
}

/** `project/{projectId}/stages/{stageId}/submissions/{submissionId}/{filename}`. */
export function stageSubmissionLocation(
	projectId: string,
	stageId: string,
	submissionId: string,
	filename: string,
): StorageLocation {
	return projectLocation(
		projectId,
		"stages",
		stageId,
		"submissions",
		submissionId,
		filename,
	);
}

/** `project/{projectId}/channels/{channelId}/attachments/{attachmentId}/{filename}`. */
export function channelAttachmentLocation(
	projectId: string,
	channelId: string,
	attachmentId: string,
	filename: string,
): StorageLocation {
	return projectLocation(
		projectId,
		"channels",
		channelId,
		"attachments",
		attachmentId,
		filename,
	);
}

/** `messages/{threadId}/{messageId}/{filename}` — gated by `comms.dm_participants` membership. */
export function messageAttachmentLocation(
	threadId: string,
	messageId: string,
	filename: string,
): StorageLocation {
	return { bucket: "messages", path: join(threadId, messageId, filename) };
}

/** `personal/users/{userId}/...segments` — owner-only. */
export function personalLocation(
	userId: string,
	...segments: Array<string | number>
): StorageLocation {
	return { bucket: "personal", path: join("users", userId, ...segments) };
}

/** `invoices/{ownerId}/{period}/{filename}` — owner read; service-role write. */
export function invoiceLocation(
	ownerId: string,
	period: string,
	filename: string,
): StorageLocation {
	return { bucket: "invoices", path: join(ownerId, period, filename) };
}

/** `verification/{subjectId}/{documentType}/{filename}` — service-role ONLY. */
export function verificationLocation(
	subjectId: string,
	documentType: string,
	filename: string,
): StorageLocation {
	return {
		bucket: "verification",
		path: join(subjectId, documentType, filename),
	};
}

/** `avatars/{entity}/{entityId}/{filename}` — public read; owner write. */
export function avatarLocation(
	entity: AvatarEntity,
	entityId: string,
	filename: string,
): StorageLocation {
	return { bucket: "avatars", path: join(entity, entityId, filename) };
}

/** `catalogue/{sellerId}/{listingId}/...segments` — public read; seller write. */
export function catalogueLocation(
	sellerId: string,
	listingId: string,
	...segments: Array<string | number>
): StorageLocation {
	return { bucket: "catalogue", path: join(sellerId, listingId, ...segments) };
}

/** `public_assets/{ownerId}/...segments` — public read; owner write. */
export function publicAssetLocation(
	ownerId: string,
	...segments: Array<string | number>
): StorageLocation {
	return { bucket: "public_assets", path: join(ownerId, ...segments) };
}

// #endregion
