import { z } from "zod";
import { BUCKETS } from "../files/storage.ts";
import type { FileStatus } from "../files/assets.ts";
import type { Sniffed } from "../files/sniff.ts";
import { CONTACT_LIMITS } from "./intake.ts";

/**
 * contact.attachments — the Zod SSOT for the files a `/contact` request carries (Decision #276).
 *
 * They reuse the files upload pipeline's three-step handshake (`api/files/upload-init` /
 * `upload-complete`): **init** declares the file and mints a `pending_upload` row in the private
 * `quarantine` bucket plus a short-lived signed URL; the browser PUTs the bytes straight to storage;
 * **complete** claims the row (`scanning`), sniffs what the bytes really are, refuses a program or a
 * type the `contact` bucket does not take, and promotes the original into `contact/{userId}/…` with
 * `purpose = 'contact'` (`uploaded`). Only then can `ops.submit_contact_request` link it.
 *
 * **Signed-in senders only.** A `files.items` row belongs to an account (`owner_user_id` is NOT NULL,
 * and the quarantine policies anchor on `auth.uid()`), so an anonymous upload would need a second,
 * unowned storage path with its own abuse controls. A guest is told why and may describe the files
 * instead; an anonymous security report carries none, because a file is in its uploader's name.
 *
 * The limits are the `contact` bucket's own (`00005040`, mirrored by `BUCKETS.contact`) and are shown
 * up front by the dropzone. CSS-free, so an island may import it.
 */

// #region Limits
const CONTACT_BUCKET = BUCKETS.contact;

/** The largest file one attachment may be (the bucket's `file_size_limit`). */
export const CONTACT_ATTACHMENT_MAX_BYTES: number = CONTACT_BUCKET.maxBytes;

/** The types the `contact` bucket accepts (its `allowed_mime_types`). */
export const CONTACT_ATTACHMENT_MIME: readonly string[] = CONTACT_BUCKET.allowedMime ?? [];

/** At most this many files on one request. */
export const CONTACT_ATTACHMENT_MAX_FILES: number = CONTACT_LIMITS.attachments;

/** The file picker's `accept`: the extensions people recognise, then the types. */
export const CONTACT_ATTACHMENT_ACCEPT = [
	".png",
	".jpg",
	".jpeg",
	".webp",
	".gif",
	".pdf",
	".txt",
	...CONTACT_ATTACHMENT_MIME,
].join(",");

/** The limits in words — the dropzone's up-front line. */
export function contactAttachmentLimitsText(): string {
	return `Up to ${CONTACT_ATTACHMENT_MAX_FILES} files, ${
		formatBytes(CONTACT_ATTACHMENT_MAX_BYTES)
	} each · ` +
		"PNG, JPEG, WebP, GIF, PDF or plain text";
}

/** A byte count for people (`10 MB`, `512 KB`). Binary units, labelled the way people read them. */
export function formatBytes(bytes: number): string {
	if (!Number.isFinite(bytes) || bytes < 1024) return `${Math.max(0, Math.round(bytes || 0))} B`;
	const kb = bytes / 1024;
	if (kb < 1024) return `${Math.round(kb)} KB`;
	const mb = kb / 1024;
	return `${mb >= 10 || Number.isInteger(mb) ? Math.round(mb) : mb.toFixed(1)} MB`;
}
// #endregion

// #region Up-front checks
/**
 * Why a file cannot be attached, before a byte moves — or `null` when it may be. The declared type
 * is a browser's guess from the name; the server re-decides from the bytes ({@link classifyContactBytes}).
 */
export function contactAttachmentProblem(
	file: { name: string; type: string; size: number },
): string | null {
	if (file.size <= 0) return `${file.name} is empty.`;
	if (file.size > CONTACT_ATTACHMENT_MAX_BYTES) {
		return `${file.name} is larger than ${formatBytes(CONTACT_ATTACHMENT_MAX_BYTES)}.`;
	}
	const type = file.type || mimeFromName(file.name);
	if (!type || !CONTACT_ATTACHMENT_MIME.includes(type)) {
		return `${file.name} isn't a type we accept — attach a picture, a PDF or a plain-text file.`;
	}
	return null;
}

/** The type a filename implies, for a browser that reported none. */
export function mimeFromName(name: string): string | null {
	const ext = /\.([a-z0-9]{1,8})$/i.exec(name)?.[1]?.toLowerCase();
	switch (ext) {
		case "png":
			return "image/png";
		case "jpg":
		case "jpeg":
			return "image/jpeg";
		case "webp":
			return "image/webp";
		case "gif":
			return "image/gif";
		case "pdf":
			return "application/pdf";
		case "txt":
			return "text/plain";
		default:
			return null;
	}
}

/** The verdict on landed bytes: the type to store, or why they are refused. */
export type ContactBytesVerdict =
	| { ok: true; mime: string }
	| { ok: false; hostile: boolean; message: string };

/**
 * Decide what landed bytes are. A recognised format must be one the bucket takes (a program or a
 * markup document is refused as hostile); an unrecognised one is accepted only as plain text, and
 * only when it was declared so and reads as text (no NUL byte, valid UTF-8) — a file with no magic
 * number is otherwise unknown, and unknown is not admitted.
 */
export function classifyContactBytes(
	sniffed: Sniffed | null,
	declaredMime: string,
	bytes: Uint8Array,
): ContactBytesVerdict {
	if (sniffed) {
		if (sniffed.family === "executable") {
			return { ok: false, hostile: true, message: "Programs can't be attached." };
		}
		if (sniffed.family === "markup") {
			return { ok: false, hostile: true, message: "Web pages and SVG files can't be attached." };
		}
		if (!CONTACT_ATTACHMENT_MIME.includes(sniffed.mime)) {
			return { ok: false, hostile: false, message: "That type of file can't be attached." };
		}
		return { ok: true, mime: sniffed.mime };
	}
	if (declaredMime === "application/pdf" && startsWith(bytes, "%PDF-")) {
		return { ok: true, mime: "application/pdf" };
	}
	if (declaredMime === "text/plain" && looksLikeText(bytes)) {
		return { ok: true, mime: "text/plain" };
	}
	return {
		ok: false,
		hostile: false,
		message: "We couldn't tell what this file is, so it wasn't attached.",
	};
}

function startsWith(bytes: Uint8Array, ascii: string): boolean {
	if (bytes.length < ascii.length) return false;
	for (let i = 0; i < ascii.length; i++) if (bytes[i] !== ascii.charCodeAt(i)) return false;
	return true;
}

/** No NUL byte and valid UTF-8 — the honest test for "this is text" without a magic number. */
export function looksLikeText(bytes: Uint8Array): boolean {
	if (bytes.includes(0)) return false;
	try {
		new TextDecoder("utf-8", { fatal: true }).decode(bytes);
		return true;
	} catch {
		return false;
	}
}
// #endregion

// #region Handshake shapes
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const uuid = z.string().regex(UUID_RE, "Expected a UUID.");

/** Step 1 — declare a file. The type and size are re-decided from the bytes at step 3. */
export const ContactAttachmentInitSchema = z.object({
	name: z.string().trim().min(1).max(200),
	mimeType: z.string().min(1).max(160),
	sizeBytes: z.number().int().min(1),
}).superRefine((v, ctx) => {
	const problem = contactAttachmentProblem({ name: v.name, type: v.mimeType, size: v.sizeBytes });
	if (problem) ctx.addIssue({ code: "custom", path: ["file"], message: problem });
});
export type ContactAttachmentInit = z.infer<typeof ContactAttachmentInitSchema>;

/**
 * Step 1's answer: where to PUT the bytes. `signedUrl` is `null` only on the development stub (the
 * contact gate off), where there is no storage to send to and step 3 answers from the declaration.
 */
export const ContactAttachmentTicketSchema = z.object({
	attachmentId: uuid,
	signedUrl: z.string().min(1).max(2000).nullable(),
	/** Headers the PUT must replay verbatim. */
	headers: z.record(z.string().max(80), z.string().max(600)),
	expiresAt: z.string(),
});
export type ContactAttachmentTicket = z.infer<typeof ContactAttachmentTicketSchema>;

/** Step 3 — the bytes landed; inspect and admit them. */
export const ContactAttachmentCompleteSchema = z.object({ attachmentId: uuid });
export type ContactAttachmentComplete = z.infer<typeof ContactAttachmentCompleteSchema>;

/**
 * Remove — take back a file that has not been sent (still uploading, or checked and ready). The row
 * is soft-deleted and its bytes deleted (`ops.discard_contact_attachment`); a file mid-check is
 * refused for a moment, a sent one for good.
 */
export const ContactAttachmentDiscardSchema = z.object({ attachmentId: uuid });
export type ContactAttachmentDiscard = z.infer<typeof ContactAttachmentDiscardSchema>;

/** What a discard answers: the id that is gone. */
export const ContactAttachmentDiscardedSchema = z.object({ id: uuid });
export type ContactAttachmentDiscarded = z.infer<typeof ContactAttachmentDiscardedSchema>;

/** The hourly sweep's answer: how many unsent attachments it took, and how many objects it could not delete. */
export const ContactAttachmentSweepSchema = z.object({
	claimed: z.number().int().min(0),
	failed: z.number().int().min(0),
});
export type ContactAttachmentSweep = z.infer<typeof ContactAttachmentSweepSchema>;

/** An admitted attachment — ready to be linked by a submission. */
export const ContactAttachmentSchema = z.object({
	id: uuid,
	name: z.string(),
	mimeType: z.string(),
	sizeBytes: z.number().int().min(1),
});
export type ContactAttachment = z.infer<typeof ContactAttachmentSchema>;
// #endregion

// #region Per-file phase
/**
 * What the dropzone shows for one file. `uploading` carries a determinate progress bar; `scanning`
 * is the pipeline's own state while step 3 inspects the bytes; `ready` and `refused` are its two
 * outcomes (a hostile or unknown file is refused, never kept).
 */
export type ContactAttachmentPhase = "queued" | "uploading" | "scanning" | "ready" | "refused";

/** The dropzone phase a stored `files.file_status` reads as. */
export function phaseForFileStatus(status: FileStatus): ContactAttachmentPhase {
	switch (status) {
		case "pending_upload":
			return "uploading";
		case "scanning":
			return "scanning";
		case "uploaded":
			return "ready";
		case "error":
		case "quarantined":
			return "refused";
	}
}

/** The words for a phase — the row's status line, also its accessible state. */
export const CONTACT_ATTACHMENT_PHASE_LABEL: Readonly<Record<ContactAttachmentPhase, string>> = {
	queued: "Waiting",
	uploading: "Uploading",
	scanning: "Checking the file",
	ready: "Ready",
	refused: "Not attached",
};
// #endregion
