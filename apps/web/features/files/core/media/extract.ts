import {
	ASSET_METADATA_VERSION,
	type AssetMetadata,
	AssetMetadataSchema,
	categorizeFile,
	categoryToKind,
	type MediaMetadata,
} from "../../types/file-types.ts";
import { readAudioMetadata } from "./audio.ts";
import { readDocumentMetadata } from "./document.ts";
import { readImageMetadata } from "./image.ts";
import { readVideoMetadata } from "./video.ts";

/**
 * extract — the one entry point the upload pipeline calls, and the only thing outside this folder
 * that needs to know any of it exists.
 *
 * ## It cannot throw, and it must not be able to
 *
 * By the time this runs the bytes are either already moving or already safe, so nothing it discovers
 * is a reason to fail an upload. Every per-kind reader already returns `null` rather than raising;
 * this wraps the dispatch as well, so a decoder that throws something nobody anticipated still
 * produces a `generic` row with a sentence in it. The envelope is then re-parsed through
 * {@link AssetMetadataSchema} before it is handed back — a producer that drifts out of the SSOT's
 * shape degrades to `generic` here rather than 422ing the completion call and stranding an uploaded
 * file that cannot be filed.
 *
 * ## What decides which reader runs
 *
 * The file's {@link FileKind}, resolved by the SAME `categorizeFile` the asset row is classified
 * with. A second MIME table here would be a second opinion about what a `.heic` is, and the row and
 * its metadata disagreeing about the kind of thing an asset is would be visible as a picture with an
 * audio player under it.
 *
 * ## It never blocks the transfer
 *
 * Callers start it and keep going; {@link awaitExtraction} is what they use at the moment the
 * completion call is made. A 200 MB video must not wait on a poster frame, and a poster frame that
 * has not arrived by then is worth less than the upload finishing.
 */

// #region Bounds
/**
 * How long a caller waits for extraction once the bytes have landed.
 *
 * The readers are individually bounded already, so this is the backstop for the case none of them
 * models — an engine that neither resolves nor rejects. Eight seconds is longer than any successful
 * extraction takes and shorter than the time it takes someone to conclude the upload has hung.
 */
export const EXTRACTION_BUDGET_MS = 8000;

/** `AssetMetadataSchema` caps the notes array here; trimming is cheaper than being rejected by it. */
const MAX_NOTES = 8;

/** And each note here. A truncated sentence still names the failure; a rejected row names nothing. */
const MAX_NOTE_LENGTH = 200;
// #endregion

// #region Envelope
/** Bound the collected notes to what the SSOT will accept, in the order they were recorded. */
function trimNotes(notes: readonly string[]): string[] {
	return notes.slice(0, MAX_NOTES).map((note) => note.slice(0, MAX_NOTE_LENGTH));
}

/** Wrap a media projection in the envelope that is written to `files.items.metadata`. */
function envelope(media: MediaMetadata, notes: readonly string[]): AssetMetadata {
	return {
		version: ASSET_METADATA_VERSION,
		source: "client",
		extractedAt: new Date().toISOString(),
		media,
		notes: trimNotes(notes),
	};
}

/**
 * The envelope for a file nothing could be read from.
 *
 * Built by hand rather than parsed, so it is the one shape this module can always produce — including
 * on the path where a parse of something else has just failed.
 */
function genericEnvelope(notes: readonly string[]): AssetMetadata {
	return envelope({ kind: "generic" }, notes);
}
// #endregion

// #region Dispatch
/** Run the reader for this file's kind, collecting its notes. `null` when nothing was readable. */
async function readMedia(file: File, notes: string[]): Promise<MediaMetadata | null> {
	const kind = categoryToKind(categorizeFile(file.name, file.type || undefined));
	switch (kind) {
		case "image":
			return await readImageMetadata(file, notes);
		case "video":
			return await readVideoMetadata(file, notes);
		case "audio":
			return await readAudioMetadata(file, notes);
		case "pdf":
		case "doc":
			return await readDocumentMetadata(file, notes);
		// An archive, a source file, a spreadsheet, a link: the kind is known and there is nothing
		// inside it a browser can read without unpacking it. `generic` says exactly that, and says it
		// without a note — an absence that was never surprising does not need explaining.
		default:
			return null;
	}
}

/**
 * Read everything this browser can about `file`.
 *
 * Always resolves, always with a valid {@link AssetMetadata}. The `generic` member is a real answer
 * rather than a failure: it says the type is known and nothing further was read, which is what a
 * consumer needs in order to stop asking.
 */
export async function extractMetadata(file: File): Promise<AssetMetadata> {
	const notes: string[] = [];
	let media: MediaMetadata | null = null;
	try {
		media = await readMedia(file, notes);
	} catch {
		notes.push("Reading this file's details failed unexpectedly, so none were stored.");
		media = null;
	}

	const candidate = envelope(media ?? { kind: "generic" }, notes);
	const parsed = AssetMetadataSchema.safeParse(candidate);
	if (parsed.success) return parsed.data;
	return genericEnvelope([
		...notes,
		"The details read from this file did not fit the expected shape, so none were stored.",
	]);
}
// #endregion

// #region Awaiting an in-flight extraction
/**
 * Settle an extraction that was started alongside the transfer.
 *
 * `null` in, `null` out — a caller that never started one sends no `metadata` at all, which is a
 * different fact from a caller that tried and got nothing, and `UploadCompleteSchema` distinguishes
 * the two by making the field both optional and nullable.
 *
 * The losing promise is not cancelled, because there is nothing here to cancel: it is left with a
 * `catch` attached so a late rejection cannot surface as an unhandled one against a queue row that
 * has already finished. The timer is always cleared — an eight-second timer per file in a
 * fifty-file drop is fifty wake-ups a settled queue does not need.
 */
export function awaitExtraction(
	pending: Promise<AssetMetadata> | null | undefined,
	budgetMs: number = EXTRACTION_BUDGET_MS,
): Promise<AssetMetadata | null> {
	if (!pending) return Promise.resolve(null);
	return new Promise<AssetMetadata | null>((resolve) => {
		let settled = false;
		const finish = (value: AssetMetadata | null) => {
			if (settled) return;
			settled = true;
			clearTimeout(timer);
			resolve(value);
		};
		const timer = setTimeout(
			() =>
				finish(
					genericEnvelope([
						"Reading this file's details took too long, so the upload was filed without them.",
					]),
				),
			budgetMs,
		);
		pending.then(finish, () =>
			finish(
				genericEnvelope(["This file's details could not be read, so none were stored."]),
			));
	});
}
// #endregion
