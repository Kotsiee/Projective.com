import { z } from "zod";
import { ImagePlaceholderSchema } from "./metadata.ts";

/**
 * files.library — the Zod SSOT for a person's MEDIA LIBRARY as the media picker reads it: the
 * processed stills and videos they own, and the two-step upload that adds one.
 *
 * A library asset is the ORIGINAL a person uploaded, kept private in their `personal` bucket with
 * three WebP tiers beside it. It is never shown publicly as-is: putting it on a profile cuts a
 * RENDITION from it (`files.items.purpose = 'avatar' | 'showcase'`), which is what a visitor sees.
 *
 * The upload is the quarantine flow: `init` records a `pending_upload` row and hands back a signed,
 * single-object URL in the private `quarantine` bucket; the browser PUTs the bytes there; `complete`
 * asks the server to inspect them (magic bytes, not the declared type), decode them, write the tiers
 * and move the original into the library. Nothing reaches the library the server has not read.
 */

// #region Limits

const MIB = 1024 * 1024;

/** The largest still the library accepts. A phone's full-size photo is well under this. */
export const LIBRARY_IMAGE_MAX_BYTES = 25 * MIB;

/** The largest video the library accepts — the `quarantine` bucket's own cap. */
export const LIBRARY_VIDEO_MAX_BYTES = 50 * MIB;

/** The size limit for a declared MIME type, or `null` when the library does not take it at all. */
export function libraryLimitFor(mimeType: string): number | null {
	const mime = mimeType.toLowerCase();
	if (mime.startsWith("image/")) return LIBRARY_IMAGE_MAX_BYTES;
	if (mime.startsWith("video/")) return LIBRARY_VIDEO_MAX_BYTES;
	return null;
}

/** "25 MB" — the size a refusal names. */
export function formatLimit(bytes: number): string {
	return `${Math.round(bytes / MIB)} MB`;
}

// #endregion

// #region The asset

/** Which slice of the library to list. The picker defaults to stills. */
export const LibraryKind = z.enum(["image", "video", "all"]);
export type LibraryKind = z.infer<typeof LibraryKind>;

/**
 * One processed library asset. `width`/`height` are the UPRIGHT dimensions of the original (after its
 * EXIF orientation is applied) — the frame a crop is expressed in. Every URL is short-lived and
 * signed: the library is private, so a copied URL stops working, and none of them is ever stored.
 */
export const LibraryAssetSchema = z.object({
	id: z.string().uuid(),
	name: z.string(),
	kind: z.enum(["image", "video"]),
	mimeType: z.string(),
	sizeBytes: z.number().int().min(0),
	width: z.number().int().positive(),
	height: z.number().int().positive(),
	/** A video's length; `null` for a still. */
	durationMs: z.number().int().min(0).nullable(),
	/** A grid-sized still (the small tier, or a video's poster). Empty when none exists. */
	thumb: z.string(),
	/** A large still to crop against (the large tier, or a video's poster). Empty when none exists. */
	preview: z.string(),
	/** The playable source of a video; for a still, the same as {@link preview}. */
	src: z.string(),
	placeholder: ImagePlaceholderSchema.optional(),
	createdAt: z.string(),
});
export type LibraryAsset = z.infer<typeof LibraryAssetSchema>;

/** A page of the library, newest first. */
export const LibraryPageSchema = z.object({
	items: z.array(LibraryAssetSchema),
	/** Opaque keyset cursor for the next page; `null` at the end. */
	nextCursor: z.string().nullable(),
});
export type LibraryPage = z.infer<typeof LibraryPageSchema>;

/** The list request. */
export const LibraryListParamsSchema = z.object({
	kind: LibraryKind.default("image"),
	cursor: z.string().max(200).nullable().default(null),
	limit: z.number().int().min(1).max(60).default(30),
});
export type LibraryListParams = z.infer<typeof LibraryListParamsSchema>;

// #endregion

// #region The upload

/**
 * Step 1: declare a file. The declared type and size are advisory — they decide only whether the
 * upload is worth starting; the server re-reads both from the stored bytes before it accepts them.
 */
export const LibraryUploadInitSchema = z.object({
	name: z.string().trim().min(1).max(200),
	mimeType: z.string().min(1).max(160),
	sizeBytes: z.number().int().min(1),
}).superRefine((v, ctx) => {
	const limit = libraryLimitFor(v.mimeType);
	if (limit === null) {
		ctx.addIssue({ code: "custom", path: ["mimeType"], message: "Choose a picture or a video." });
	} else if (v.sizeBytes > limit) {
		ctx.addIssue({
			code: "custom",
			path: ["sizeBytes"],
			message: `This file is larger than ${formatLimit(limit)}.`,
		});
	}
});
export type LibraryUploadInit = z.infer<typeof LibraryUploadInitSchema>;

/** Step 1's answer: where to PUT the bytes, and the row they will finalise. */
export const LibraryUploadTicketSchema = z.object({
	assetId: z.string().uuid(),
	signedUrl: z.string().min(1).max(2000),
	/** Headers the PUT must send verbatim. */
	headers: z.record(z.string().max(80), z.string().max(600)),
	expiresAt: z.string(),
});
export type LibraryUploadTicket = z.infer<typeof LibraryUploadTicketSchema>;

/**
 * Step 3: the bytes landed. `posterDataUrl` is the browser's captured still of a VIDEO — the one
 * thing the server cannot make itself (it does not decode video) — and is decoded and re-encoded like
 * any upload before it is kept; it is ignored for a still, whose tiers the server draws itself.
 */
export const LibraryUploadCompleteSchema = z.object({
	assetId: z.string().uuid(),
	posterDataUrl: z.string().max(400_000).startsWith("data:image/").nullable().optional(),
	durationMs: z.number().int().min(0).max(24 * 60 * 60 * 1000).nullable().optional(),
});
export type LibraryUploadComplete = z.infer<typeof LibraryUploadCompleteSchema>;

// #endregion
