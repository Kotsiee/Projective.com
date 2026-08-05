import { z } from "zod";
import { AssetItemSchema } from "./assets.ts";

/**
 * files.dedup — the Zod SSOT for content-addressed duplicate detection.
 *
 * The point is not disk savings, it is the moment before an upload: a person drags in a file they
 * already have, and the hub can say so BEFORE the bytes travel, then offer to link the existing copy
 * instead. That turns a 400 MB re-upload into a click.
 *
 * **Two digest strengths, and the difference is load-bearing.** Hashing a multi-gigabyte file in the
 * browser blocks the main thread and takes long enough that the person gives up, so anything over
 * {@link SAMPLE_THRESHOLD_BYTES} is digested from a SAMPLE — the head window, the tail window and the
 * exact length — and reported as `sampled-sha-256`.
 *
 * **A sampled digest is a HINT the server must confirm.** Two files sharing a head, a tail and a
 * length are very probably the same file and are absolutely not certainly the same file. The client
 * may use a sampled match to prompt ("looks like you already have this"); the SERVER must re-digest in
 * full before it collapses two rows onto one stored object, because a false positive there does not
 * save a copy — it silently replaces one person's file with someone else's. `AssetItem.hashSampled`
 * carries that strength alongside the hash so the claim can never be read as stronger than it is.
 *
 * Only enum/array/string/number/boolean primitives are used so the module stays stable across Zod
 * majors.
 */

// #region Constants

/**
 * Above this size the client samples instead of digesting the whole file. 256 MiB is roughly where a
 * full in-browser digest stops finishing inside the window a person will wait through.
 */
export const SAMPLE_THRESHOLD_BYTES = 256 * 1024 * 1024;

/**
 * How many bytes are read from the head and from the tail when sampling. 1 MiB each side is enough to
 * separate files that merely share a container header (every MP4 opens alike) while staying instant.
 */
export const SAMPLE_WINDOW_BYTES = 1024 * 1024;

/** Maximum fingerprints in one pre-flight batch — a multi-file drop is checked in one round trip. */
export const DEDUP_BATCH_MAX = 50;

// #endregion

// #region Vocabulary

/**
 * How a digest was computed. `sha-256` covers every byte and is authoritative; `sampled-sha-256`
 * covers the head window, the tail window and the length, and is a hint (see the module note).
 */
export const HashAlgo = z.enum(["sha-256", "sampled-sha-256"]);
export type HashAlgo = z.infer<typeof HashAlgo>;

/**
 * What the server found.
 *
 * - `new`             — nothing matches; upload normally.
 * - `exact_duplicate` — the same CONTENT already exists in this owner's library.
 * - `name_collision`  — a DIFFERENT file already sits at this name in the target folder.
 *
 * The two non-`new` outcomes are deliberately separate because they need opposite answers: an exact
 * duplicate wants "link the one you have", a name collision wants "rename or replace". Collapsing
 * them into one "conflict" would put the wrong verbs in front of both.
 */
export const DedupOutcome = z.enum(["new", "exact_duplicate", "name_collision"]);
export type DedupOutcome = z.infer<typeof DedupOutcome>;

/**
 * What the person chose to do about a conflict.
 *
 * `link_existing` stores a second reference to the bytes already held; `upload_copy` keeps both as
 * independent assets; `replace` overwrites the existing asset in place; `cancel` abandons the upload.
 * `cancel` is a first-class member rather than an absent value so a dismissed prompt is a recorded
 * decision and not an ambiguous silence.
 */
export const DuplicateResolution = z.enum([
	"link_existing",
	"upload_copy",
	"replace",
	"cancel",
]);
export type DuplicateResolution = z.infer<typeof DuplicateResolution>;

// #endregion

// #region Fingerprint

/** A 64-character lowercase hex SHA-256 digest. */
const HEX_SHA256 = /^[0-9a-f]{64}$/;

/**
 * One file's content fingerprint, computed client-side before the upload.
 *
 * `sizeBytes` travels WITH the hash rather than being looked up later because it is part of what a
 * sampled digest actually covers — two files with the same head and tail but different lengths are
 * different files, and the length is what proves it.
 */
export const ContentFingerprintSchema = z.object({
	algo: HashAlgo,
	/** Lowercase hex SHA-256. Case is normalised at the boundary so equality is a string compare. */
	hash: z.string().regex(HEX_SHA256, "Expected a 64-character lowercase hex SHA-256 digest."),
	sizeBytes: z.number().int().min(0),
	/** Mirrors `algo === "sampled-sha-256"`; persisted as `files.items.hash_sampled`. */
	sampled: z.boolean(),
});
export type ContentFingerprint = z.infer<typeof ContentFingerprintSchema>;

// #endregion

// #region Check + verdict

/** A pre-flight batch — every file in one drop, checked before any bytes move. */
export const DedupCheckSchema = z.object({
	fingerprints: z.array(ContentFingerprintSchema).min(1).max(DEDUP_BATCH_MAX),
	/** The folder the drop is targeting — `name_collision` is scoped to it, not to the whole library. */
	folderId: z.string().max(120).nullable().optional(),
	/** The filenames being uploaded, positionally aligned with `fingerprints`. */
	names: z.array(z.string().min(1).max(200)).max(DEDUP_BATCH_MAX).optional(),
});
export type DedupCheck = z.infer<typeof DedupCheckSchema>;

/**
 * The server's answer for one file.
 *
 * `existing` is the asset that was matched — populated for both non-`new` verdicts so the prompt can
 * show WHAT it found (its name, folder, when it was added) instead of asserting a duplicate the person
 * has to go and find. `null` when the verdict is `new`.
 */
export const DedupVerdictSchema = z.object({
	verdict: DedupOutcome,
	existing: AssetItemSchema.nullable(),
});
export type DedupVerdict = z.infer<typeof DedupVerdictSchema>;

// #endregion

// #region Pure helpers

/**
 * Whether a file of this size should be sampled rather than digested in full.
 *
 * Strictly greater than the threshold, so a file exactly at the boundary still gets an authoritative
 * full digest — the stronger claim is the right one to make wherever it is affordable.
 */
export function shouldSample(sizeBytes: number): boolean {
	return Number.isFinite(sizeBytes) && sizeBytes > SAMPLE_THRESHOLD_BYTES;
}

// #endregion
