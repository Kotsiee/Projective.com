import {
	type AssetItem,
	type AssetMetadata,
	bucketMeta,
	describeFile,
	type DedupVerdict,
	libraryLocation,
	PROCESSABLE_IMAGE_MIME,
	quarantineLocation,
	sniffBytes,
	SNIFF_BYTES,
	type StorageLocation,
	type UploadComplete,
	type UploadInit,
	type UploadTicket,
	workspaceLocation,
} from "@projective/types/files";
import { getServiceClient, getUserClient } from "../../core/supabase.ts";
import { downloadObject, removeObjects, signedUploadUrl, uploadObject } from "../../core/storage-signed.ts";
import type { ReadActor } from "../read-actor.ts";
import { imageEnvelope, objectName, writeTiers } from "../media/library.ts";
import { MediaPipeline } from "../media/pipeline.ts";
import { dedupVerdicts, type FilesOwner, mayFileInto, readAsset, readQuota } from "./live-library.ts";

/**
 * live-uploads — the `/files` hub's upload handshake, live: declare → PUT → complete.
 *
 *  1. {@link initUpload} records a `pending_upload` row under the caller's OWN session (the items policy
 *     and `files.fn_guard_pipeline_columns` both hold: a client may only DECLARE an upload, in the
 *     private `quarantine` bucket) and mints a signed, single-object upload URL. Bytes never pass
 *     through an application request.
 *  2. The browser PUTs the file straight to storage.
 *  3. {@link completeUpload} claims the row (`pending_upload → scanning`, so two completes cannot both
 *     process one upload), reads the stored bytes, sniffs what they really are (a filename's type is a
 *     guess), refuses a program, re-digests the content in full (a client's hash is a hint, never
 *     evidence), processes a picture into WebP tiers and a BlurHash through the media pipeline, and
 *     promotes the original out of quarantine into the owner's private `personal` bucket (or the
 *     entity's `workspace`). Only then is it `uploaded`.
 *
 * The promotion runs as the service role — it writes exactly the columns the pipeline guard withholds
 * from a client — and is reached only after the caller's session has proved the row is theirs.
 *
 * There is no malware scanner in this deployment: "scanning" is the sniff that refuses programs and
 * the byte-level checks above. Recorded here rather than implied by the status name.
 */

type Actor = ReadActor & { accessToken: string };
type Result<T> = { ok: true; data: T; status?: number; message?: string } | {
	ok: false;
	status: number;
	message: string;
	errors?: Record<string, string>;
};

const UNAVAILABLE = "Uploads are unavailable right now. Try again in a moment.";
const DENIED_OWNER = "You can't add files to that library.";

/** Where an owner's library original lives once it has left quarantine. */
function destinationFor(owner: FilesOwner, userId: string, assetId: string, filename: string): StorageLocation {
	return owner.ownerType === "user"
		? libraryLocation(userId, assetId, filename)
		: workspaceLocation(owner.ownerId, "library", assetId, filename);
}

/** The largest single file the destination bucket accepts. */
function maxBytesFor(owner: FilesOwner): number {
	return bucketMeta(owner.ownerType === "user" ? "personal" : "workspace").maxBytes;
}

function mib(bytes: number): string {
	return `${Math.round(bytes / (1024 * 1024))} MB`;
}

/** Lower-case hex SHA-256 of a byte array. */
async function sha256Hex(bytes: Uint8Array): Promise<string> {
	const digest = await crypto.subtle.digest("SHA-256", bytes as unknown as ArrayBuffer);
	return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

// #region Init

/**
 * Declare an upload into the acting library and answer with a scoped ticket.
 *
 * The allowance is METERED here: over it, the upload is refused only once the platform enforces
 * storage quotas (fail-open until a human flips `storage_quota_enforced`), and otherwise warned about.
 */
export async function initUpload(actor: Actor, input: UploadInit): Promise<Result<UploadTicket>> {
	const owner: FilesOwner = { ownerType: input.ownerType, ownerId: input.ownerId };
	if (!mayFileInto(actor, owner)) return { ok: false, status: 403, message: DENIED_OWNER };
	const limit = maxBytesFor(owner);
	if (input.sizeBytes > limit) {
		return { ok: false, status: 422, message: `This file is larger than ${mib(limit)}.`, errors: { file: "too_large" } };
	}

	const db = getUserClient(actor.accessToken).schema("files");
	if (input.folderId) {
		const target = await db.from("folders").select("owner_type, owner_user_id, owner_entity_id")
			.eq("id", input.folderId).is("deleted_at", null).maybeSingle();
		const t = target.data as { owner_type: string; owner_user_id: string; owner_entity_id: string | null } | null;
		if (!t || t.owner_type !== owner.ownerType || (t.owner_entity_id ?? t.owner_user_id) !== owner.ownerId) {
			return { ok: false, status: 404, message: "That folder isn't in this library." };
		}
	}

	const quota = await readQuota(actor, owner);
	let note: string | undefined;
	if (quota.ok && quota.data.limitMib !== null) {
		const projected = quota.data.usedMib + input.sizeBytes / (1024 * 1024);
		const over = Math.round((projected - quota.data.limitMib) * 10) / 10;
		if (over > 0) {
			if (quota.data.enforced) {
				// The route emits `entitlement.denied` — a RAISE inside Postgres would roll back that
				// telemetry row, so the app layer owns it (Decision #58).
				return {
					ok: false,
					status: 422,
					message: `This upload is ${over} MB over your storage allowance.`,
					errors: { quota: `Over by ${over} MB.` },
				};
			}
			note = `This upload takes you ${over} MB past your storage allowance.`;
		}
	}

	const [verdict] = await dedupVerdicts(actor, {
		fingerprints: [input.fingerprint ?? {
			// An insecure context has no `crypto.subtle`, so a browser may genuinely be unable to hash:
			// that costs the duplicate prompt, never the upload. No stored row carries this digest.
			algo: "sha-256",
			hash: "0".repeat(64),
			sizeBytes: input.sizeBytes,
			sampled: false,
		}],
		folderId: input.folderId,
		names: [input.name],
	}, owner);

	const assetId = crypto.randomUUID();
	const ext = (/\.([a-z0-9]{1,8})$/i.exec(input.name)?.[1] ?? "bin").toLowerCase();
	const location = quarantineLocation(actor.userId, assetId, objectName(input.name, ext));
	const { error } = await db.from("items").insert({
		id: assetId,
		owner_user_id: actor.userId,
		owner_type: owner.ownerType,
		owner_entity_id: owner.ownerType === "user" ? null : owner.ownerId,
		folder_id: input.folderId ?? null,
		bucket_id: location.bucket,
		storage_path: location.path,
		display_name: input.name,
		original_name: input.name,
		mime_type: input.mimeType,
		size_bytes: input.sizeBytes,
		category: describeFile(input.name, input.mimeType).category,
		content_hash: input.fingerprint?.hash ?? null,
		hash_algo: input.fingerprint?.algo ?? null,
		hash_sampled: input.fingerprint?.sampled ?? false,
		status: "pending_upload",
		visibility: input.visibility,
		source: "supabase",
		purpose: "library",
	});
	if (error) {
		if (error.code === "42501") return { ok: false, status: 403, message: DENIED_OWNER };
		throw new Error(`files.items insert failed: ${error.message}`);
	}

	const signed = await signedUploadUrl(location.bucket, location.path);
	if (!signed) {
		await markRow(assetId, "error");
		return { ok: false, status: 503, message: UNAVAILABLE };
	}
	return {
		ok: true,
		status: 201,
		message: note,
		data: {
			assetId,
			bucket: "quarantine",
			path: location.path,
			signedUrl: signed.url,
			expiresAt: signed.expiresAt,
			headers: { "content-type": input.mimeType || "application/octet-stream", "x-upsert": "false" },
			dedup: verdict ?? ({ verdict: "new", existing: null } satisfies DedupVerdict),
		},
	};
}

// #endregion

// #region Complete

interface PendingRow {
	id: string;
	owner_type: string;
	owner_user_id: string;
	owner_entity_id: string | null;
	bucket_id: string;
	storage_path: string;
	display_name: string;
	mime_type: string;
	size_bytes: number | string;
	status: string;
	purpose: string;
}

/** Set a row's processing status (service role). Best-effort: the row then stays for a sweep to find. */
async function markRow(id: string, status: "error" | "quarantined" | "pending_upload"): Promise<void> {
	try {
		await getServiceClient().schema("files").from("items")
			.update({ status, updated_at: new Date().toISOString() }).eq("id", id);
	} catch { /* the sweep finds it */ }
}

/** A file refused at inspection leaves quarantine (its bytes are never kept) and says why. */
async function refuse(row: PendingRow, hostile: boolean, message: string): Promise<Result<never>> {
	await removeObjects("quarantine", [row.storage_path]);
	await markRow(row.id, hostile ? "quarantined" : "error");
	return { ok: false, status: 422, message, errors: { file: hostile ? "rejected" : "unsupported" } };
}

/**
 * Finish an upload the caller declared. Idempotent for a caller retrying after a lost response: an
 * upload already `uploaded` answers with the finished asset rather than processing it twice.
 *
 * `input.metadata` is the browser's reading of the bytes (a video's duration and poster, a PDF's page
 * count) — kept only where the server has no reading of its own, and never trusted for anything a read
 * decision rests on.
 */
export async function completeUpload(actor: Actor, input: UploadComplete): Promise<Result<AssetItem>> {
	const mine = await getUserClient(actor.accessToken).schema("files").from("items")
		.select("id, owner_type, owner_user_id, owner_entity_id, bucket_id, storage_path, display_name, mime_type, size_bytes, status, purpose")
		.eq("id", input.assetId).eq("owner_user_id", actor.userId).maybeSingle();
	if (mine.error && mine.error.code !== "22P02") throw new Error(`files.items read failed: ${mine.error.message}`);
	const row = mine.data as PendingRow | null;
	if (!row || row.purpose !== "library") return { ok: false, status: 404, message: "That upload could not be found." };
	if (row.status === "uploaded") {
		const done = await readAsset(actor, row.id);
		return done ? { ok: true, data: done } : { ok: false, status: 404, message: "That upload could not be found." };
	}
	if (row.status !== "pending_upload" || row.bucket_id !== "quarantine") {
		return { ok: false, status: 409, message: "This upload can't be finished. Upload the file again." };
	}

	const service = getServiceClient().schema("files");
	const claim = await service.from("items")
		.update({ status: "scanning", updated_at: new Date().toISOString() })
		.eq("id", row.id).eq("status", "pending_upload").select("id");
	if (claim.error) throw new Error(`files.items claim failed: ${claim.error.message}`);
	if (!claim.data || claim.data.length === 0) {
		return { ok: false, status: 409, message: "This upload is already being processed." };
	}

	const written: Array<{ bucket: string; path: string }> = [];
	try {
		const bytes = await downloadObject("quarantine", row.storage_path);
		if (!bytes || bytes.byteLength === 0) {
			await markRow(row.id, "error");
			return { ok: false, status: 422, message: "The file didn't finish uploading. Try again.", errors: { file: "missing" } };
		}
		const owner: FilesOwner = row.owner_type === "user"
			? { ownerType: "user", ownerId: row.owner_user_id }
			: { ownerType: row.owner_type as FilesOwner["ownerType"], ownerId: row.owner_entity_id ?? "" };
		if (bytes.byteLength > maxBytesFor(owner)) {
			return await refuse(row, false, `This file is larger than ${mib(maxBytesFor(owner))}.`);
		}

		const sniffed = sniffBytes(bytes.subarray(0, SNIFF_BYTES));
		if (sniffed?.family === "executable") return await refuse(row, true, "Programs can't be uploaded.");
		const mime = sniffed?.mime ?? (row.mime_type || "application/octet-stream");
		const ext = sniffed?.ext ?? ((/\.([a-z0-9]{1,8})$/i.exec(row.display_name)?.[1] ?? "bin").toLowerCase());
		const destination = destinationFor(owner, row.owner_user_id, row.id, objectName(row.display_name, ext));

		// A picture the pipeline can read gets its tiers and a measured envelope; one it cannot is
		// admitted as a plain file — the hub holds any file, and failing to preview is not a refusal.
		let metadata: AssetMetadata | undefined = input.metadata ?? undefined;
		let tiers: Awaited<ReturnType<typeof writeTiers>> = [];
		if (sniffed && PROCESSABLE_IMAGE_MIME.includes(sniffed.mime)) {
			try {
				const result = await MediaPipeline.run({ kind: "ingest", bytes, mime: sniffed.mime });
				const tierPaths: string[] = [];
				tiers = await writeTiers(destination.bucket, destination.path, result.tiers, tierPaths, false);
				for (const p of tierPaths) written.push({ bucket: destination.bucket, path: p });
				metadata = imageEnvelope(result);
			} catch {
				tiers = [];
			}
		}

		if (!await uploadObject(destination.bucket, destination.path, bytes, mime)) {
			throw new Error("storage refused the original");
		}
		written.push({ bucket: destination.bucket, path: destination.path });

		const update: Record<string, unknown> = {
			bucket_id: destination.bucket,
			storage_path: destination.path,
			mime_type: mime,
			size_bytes: bytes.byteLength,
			category: describeFile(row.display_name, mime).category,
			// The server's own digest of the WHOLE file replaces the client's hint — it is what a later
			// duplicate check can actually rely on.
			content_hash: await sha256Hex(bytes),
			hash_algo: "sha-256",
			hash_sampled: false,
			status: "uploaded",
			updated_at: new Date().toISOString(),
		};
		if (metadata) update.metadata = metadata;
		const promoted = await service.from("items").update(update).eq("id", row.id);
		if (promoted.error) throw new Error(promoted.error.message);

		if (tiers.length > 0) {
			const variants = await service.from("item_variants").upsert(
				tiers.map((t) => ({
					item_id: row.id,
					tier: t.tier,
					bucket_id: destination.bucket,
					storage_path: t.path,
					mime_type: "image/webp",
					width: t.width,
					height: t.height,
					size_bytes: t.size,
				})),
				{ onConflict: "item_id,tier" },
			);
			if (variants.error) throw new Error(variants.error.message);
		}

		await removeObjects("quarantine", [row.storage_path]);
		const asset = await readAsset(actor, row.id);
		return asset
			? { ok: true, data: asset, message: "Upload complete." }
			: { ok: false, status: 503, message: UNAVAILABLE };
	} catch (error) {
		for (const bucket of new Set(written.map((w) => w.bucket))) {
			await removeObjects(bucket, written.filter((w) => w.bucket === bucket).map((w) => w.path));
		}
		// Storage or the pipeline failed, not the file: put the row back so a retry can finish it.
		await markRow(row.id, "pending_upload");
		console.error("[files:upload-complete]", error instanceof Error ? error.message : error);
		return { ok: false, status: 503, message: UNAVAILABLE };
	}
}

// #endregion
