import {
	classifyContactBytes,
	CONTACT_ATTACHMENT_MAX_BYTES,
	type ContactAttachment,
	type ContactAttachmentInit,
	type ContactAttachmentTicket,
	formatBytes,
} from "@projective/types/contact";
import {
	contactLocation,
	describeFile,
	quarantineLocation,
	SNIFF_BYTES,
	sniffBytes,
} from "@projective/types/files";
import { fail, ok, type ServiceResult } from "../ServiceResult.ts";
import { getServiceClient, getUserClient } from "../../core/supabase.ts";
import {
	downloadObject,
	removeObjects,
	signedUploadUrl,
	uploadObject,
} from "../../core/storage-signed.ts";
import { objectName } from "../media/library.ts";

/**
 * live-attachments — a `/contact` request's files, through the files upload pipeline (Decision #276).
 *
 * The same three steps as `/files` (`services/files/live-uploads.ts`), with a different destination:
 *
 *  1. {@link initContactUpload} records a `pending_upload` row in `quarantine` under the caller's OWN
 *     session — the items policy and `files.fn_guard_pipeline_columns` hold exactly as for a library
 *     upload — marked `target_bucket = 'contact'` so only this pipeline will finish it, and mints a
 *     signed, single-object upload URL. The bytes never pass through an application request.
 *  2. The browser PUTs the file straight to storage, reporting byte progress.
 *  3. {@link completeContactUpload} claims the row (`pending_upload → scanning`, so two completes
 *     cannot both run), reads the stored bytes, decides what they really are
 *     (`classifyContactBytes`: a program or a web page is refused as hostile and the row parked
 *     `quarantined`; a type the bucket does not take, or bytes with no recognisable format, are
 *     refused as `error`), digests them in full, and promotes the original into
 *     `contact/{userId}/{assetId}/…` with `purpose = 'contact'` — only then `uploaded`, and only then
 *     linkable by `ops.submit_contact_request`. A refused file's bytes are never kept.
 *
 * The promotion runs as the service role (it writes the columns the pipeline guard withholds from a
 * client) and is reached only after the caller's session has proved the row is theirs. There is no
 * malware scanner in this deployment: "checking" is the byte sniff and the type rule above, as for
 * every upload on the platform.
 */

type Actor = { userId: string; accessToken: string };

const UNAVAILABLE = "Attachments are unavailable right now. Try again in a moment.";
const NOT_FOUND = "That attachment could not be found. Attach the file again.";

// #region Init
/** Declare a contact attachment and answer with where to PUT its bytes. */
export async function initContactUpload(
	actor: Actor,
	input: ContactAttachmentInit,
): Promise<ServiceResult<ContactAttachmentTicket>> {
	const assetId = crypto.randomUUID();
	const ext = (/\.([a-z0-9]{1,8})$/i.exec(input.name)?.[1] ?? "bin").toLowerCase();
	const location = quarantineLocation(actor.userId, assetId, objectName(input.name, ext));
	const { error } = await getUserClient(actor.accessToken).schema("files").from("items").insert({
		id: assetId,
		owner_user_id: actor.userId,
		owner_type: "user",
		owner_entity_id: null,
		folder_id: null,
		bucket_id: location.bucket,
		storage_path: location.path,
		target_bucket: "contact",
		display_name: input.name,
		original_name: input.name,
		mime_type: input.mimeType,
		size_bytes: input.sizeBytes,
		category: describeFile(input.name, input.mimeType).category,
		status: "pending_upload",
		visibility: "private",
		source: "supabase",
		purpose: "library",
	});
	if (error) {
		if (error.code === "42501") return fail(401, { message: "Sign in to attach files." });
		console.error("[contact:attachment-init]", error.message);
		return fail(503, { message: UNAVAILABLE, details: { code: error.code ?? null } });
	}

	const signed = await signedUploadUrl(location.bucket, location.path);
	if (!signed) {
		await markRow(assetId, "error");
		return fail(503, { message: UNAVAILABLE });
	}
	return ok({
		attachmentId: assetId,
		signedUrl: signed.url,
		headers: { "content-type": input.mimeType || "application/octet-stream", "x-upsert": "false" },
		expiresAt: signed.expiresAt,
	}, { status: 201 });
}
// #endregion

// #region Complete
interface PendingRow {
	id: string;
	owner_user_id: string;
	bucket_id: string;
	storage_path: string;
	target_bucket: string | null;
	display_name: string;
	mime_type: string;
	size_bytes: number | string;
	status: string;
	purpose: string;
}

/** Set a row's processing status (service role). Best-effort: the row then stays for a sweep to find. */
async function markRow(
	id: string,
	status: "error" | "quarantined" | "pending_upload",
): Promise<void> {
	try {
		await getServiceClient().schema("files").from("items")
			.update({ status, updated_at: new Date().toISOString() }).eq("id", id);
	} catch { /* the sweep finds it */ }
}

/** A refused file leaves quarantine (its bytes are never kept) and says why. */
async function refuse(
	row: PendingRow,
	hostile: boolean,
	message: string,
): Promise<ServiceResult<never>> {
	await removeObjects("quarantine", [row.storage_path]);
	await markRow(row.id, hostile ? "quarantined" : "error");
	return fail(422, { message, errors: { file: hostile ? "rejected" : "unsupported" } });
}

async function sha256Hex(bytes: Uint8Array): Promise<string> {
	const digest = await crypto.subtle.digest("SHA-256", bytes as unknown as ArrayBuffer);
	return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

function asAttachment(
	row: Pick<PendingRow, "id" | "display_name" | "mime_type" | "size_bytes">,
): ContactAttachment {
	return {
		id: row.id,
		name: row.display_name,
		mimeType: row.mime_type,
		sizeBytes: Number(row.size_bytes),
	};
}

/**
 * Inspect and admit an attachment the caller declared. Idempotent for a retry after a lost response:
 * an attachment already admitted answers as it is rather than being processed twice.
 */
export async function completeContactUpload(
	actor: Actor,
	attachmentId: string,
): Promise<ServiceResult<ContactAttachment>> {
	const mine = await getUserClient(actor.accessToken).schema("files").from("items")
		.select(
			"id, owner_user_id, bucket_id, storage_path, target_bucket, display_name, mime_type, size_bytes, status, purpose",
		)
		.eq("id", attachmentId).eq("owner_user_id", actor.userId).maybeSingle();
	if (mine.error && mine.error.code !== "22P02") {
		console.error("[contact:attachment-complete]", mine.error.message);
		return fail(503, { message: UNAVAILABLE });
	}
	const row = mine.data as PendingRow | null;
	if (!row) return fail(404, { message: NOT_FOUND });
	if (row.purpose === "contact" && row.status === "uploaded") {
		return ok(asAttachment(row), { message: "Attachment ready." });
	}
	if (row.target_bucket !== "contact" || row.purpose !== "library") {
		return fail(404, { message: NOT_FOUND });
	}
	if (row.status !== "pending_upload" || row.bucket_id !== "quarantine") {
		return fail(409, { message: "This file can't be finished. Attach it again." });
	}

	const service = getServiceClient().schema("files");
	const claim = await service.from("items")
		.update({ status: "scanning", updated_at: new Date().toISOString() })
		.eq("id", row.id).eq("status", "pending_upload").select("id");
	if (claim.error) {
		console.error("[contact:attachment-claim]", claim.error.message);
		return fail(503, { message: UNAVAILABLE });
	}
	if (!claim.data || claim.data.length === 0) {
		return fail(409, { message: "This file is already being checked." });
	}

	let written: string | null = null;
	try {
		const bytes = await downloadObject("quarantine", row.storage_path);
		if (!bytes || bytes.byteLength === 0) {
			await markRow(row.id, "error");
			return fail(422, {
				message: "The file didn't finish uploading. Try again.",
				errors: { file: "missing" },
			});
		}
		if (bytes.byteLength > CONTACT_ATTACHMENT_MAX_BYTES) {
			return await refuse(
				row,
				false,
				`This file is larger than ${formatBytes(CONTACT_ATTACHMENT_MAX_BYTES)}.`,
			);
		}
		const sniffed = sniffBytes(bytes.subarray(0, SNIFF_BYTES));
		const verdict = classifyContactBytes(sniffed, row.mime_type, bytes);
		if (!verdict.ok) return await refuse(row, verdict.hostile, verdict.message);

		const ext = sniffed?.ext ?? (verdict.mime === "application/pdf" ? "pdf" : "txt");
		const destination = contactLocation(
			row.owner_user_id,
			row.id,
			objectName(row.display_name, ext),
		);
		if (!await uploadObject(destination.bucket, destination.path, bytes, verdict.mime)) {
			throw new Error("storage refused the original");
		}
		written = destination.path;

		const promoted = await service.from("items").update({
			bucket_id: destination.bucket,
			storage_path: destination.path,
			target_bucket: null,
			mime_type: verdict.mime,
			size_bytes: bytes.byteLength,
			category: describeFile(row.display_name, verdict.mime).category,
			content_hash: await sha256Hex(bytes),
			hash_algo: "sha-256",
			hash_sampled: false,
			status: "uploaded",
			purpose: "contact",
			updated_at: new Date().toISOString(),
		}).eq("id", row.id);
		if (promoted.error) throw new Error(promoted.error.message);

		await removeObjects("quarantine", [row.storage_path]);
		return ok(
			asAttachment({
				id: row.id,
				display_name: row.display_name,
				mime_type: verdict.mime,
				size_bytes: bytes.byteLength,
			}),
			{ message: "Attachment ready." },
		);
	} catch (error) {
		if (written) await removeObjects("contact", [written]);
		// Storage failed, not the file: put the row back so a retry can finish it.
		await markRow(row.id, "pending_upload");
		console.error("[contact:attachment-complete]", error instanceof Error ? error.message : error);
		return fail(503, { message: UNAVAILABLE });
	}
}
// #endregion
