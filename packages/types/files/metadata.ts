import { z } from "zod";

/**
 * files.metadata — the Zod SSOT for what was READ out of an asset's bytes, persisted verbatim into
 * `files.items.metadata`.
 *
 * Extraction happens once, in the browser, alongside the upload; everything downstream — the grid's
 * placeholder, the preview's checkerboard ground, the waveform, the poster frame — reads this row
 * rather than re-decoding a 200 MB file to answer a question that was already answered.
 *
 * **Every absence is modelled, never a placeholder.** A null `blurhash` on a 4 GB video and a null
 * `blurhash` on a CORS-blocked one are different facts, and a reader that cannot tell them apart will
 * retry the wrong one forever — so the reason lands in {@link AssetMetadataSchema.notes} while the
 * field itself stays honestly null. Nothing here is ever filled with a plausible default: a fabricated
 * dimension renders a layout that is confidently wrong, which is strictly worse than a missing one.
 *
 * The union is discriminated on `kind` and is EXHAUSTIVE — `generic` is the real fallback member
 * rather than an absent branch, so "we know the type and could read nothing further" is a value a
 * consumer can switch on instead of a shape it has to guess at.
 *
 * Only string/number/boolean/array/literal primitives are used so the schema stays stable across Zod
 * majors (matching the sibling files schemas).
 */

// #region Colour + hash primitives
/**
 * A BlurHash string — the compact LQIP placeholder.
 *
 * Bounded and charset-constrained because the value is written straight into a `background-image`
 * expression after decoding: an unbounded string from a client is an unbounded row, and the base83
 * alphabet is the whole vocabulary a real hash can contain, so anything outside it is not a short
 * hash but a different thing entirely.
 */
export const BlurHashSchema = z.string().min(6).max(160)
	.regex(/^[0-9A-Za-z#$%*+,\-.:;=?@[\]^_{|}~]+$/, "Not a BlurHash.");

/**
 * An sRGB hex colour, lower-case, with the leading hash.
 *
 * One canonical spelling rather than a permissive parse: these values are compared for equality (is
 * this the same dominant colour as the last frame) and used as object keys, and `#FFF`, `#ffffff` and
 * `#FFFFFF` comparing unequal is a bug that only shows up on the assets that happen to be grey.
 */
export const HexColorSchema = z.string().regex(/^#[0-9a-f]{6}$/, "Expected a lower-case #rrggbb.");

/** Colour summary shared by images and video thumbnails. */
export const ColorSummarySchema = z.object({
	/** The flat average of every sampled pixel. */
	average: HexColorSchema,
	/** Up to three dominant colours, most prominent first. */
	dominant: z.array(HexColorSchema).max(3),
});
export type ColorSummary = z.infer<typeof ColorSummarySchema>;
// #endregion

// #region Per-kind media metadata
/**
 * A raster or vector image.
 *
 * `hasAlpha` is a THREE-state field — `true`, `false`, and `null` for "the decoder did not say". The
 * preview draws a checkerboard ground for transparency, and drawing one behind an opaque JPEG because
 * an unknown was coerced to `true` is as wrong as omitting it behind a cut-out PNG.
 */
export const ImageMetadataSchema = z.object({
	kind: z.literal("image"),
	width: z.number().int().positive(),
	height: z.number().int().positive(),
	/** `width / height`, rounded to 4dp. */
	aspectRatio: z.number().positive(),
	blurhash: BlurHashSchema.nullable(),
	colors: ColorSummarySchema.nullable(),
	/** True when the decoder reported more than one frame (animated GIF/WebP/AVIF). */
	animated: z.boolean().default(false),
	/** True when the source is vector (SVG) — dimensions come from the viewBox and may be nominal. */
	vector: z.boolean().default(false),
	/** An alpha channel is present. `null` = the decoder did not report one either way. */
	hasAlpha: z.boolean().nullable().default(null),
});
export type ImageMetadata = z.infer<typeof ImageMetadataSchema>;

/**
 * A video, plus the poster frame captured from it.
 *
 * `posterDataUrl` is nullable and separately bounded because capture is the step most likely to fail:
 * a cross-origin source taints the canvas and `getImageData` throws, and DRM refuses outright. Both
 * degrade to a null poster with a note, never to a failed upload — the bytes are already safe by the
 * time this runs.
 */
export const VideoMetadataSchema = z.object({
	kind: z.literal("video"),
	width: z.number().int().positive(),
	height: z.number().int().positive(),
	aspectRatio: z.number().positive(),
	durationMs: z.number().int().min(0),
	/** Pre-formatted by {@link durationLabelOf}, matching `MessageAudio.durationLabel`. */
	durationLabel: z.string().max(12),
	/** BlurHash of the extracted poster frame. */
	blurhash: BlurHashSchema.nullable(),
	colors: ColorSummarySchema.nullable(),
	/** Milliseconds into the video the poster was taken from. */
	posterAtMs: z.number().int().min(0),
	/** A `data:` URL of the poster frame (JPEG), or `null` when capture was refused (CORS/DRM). */
	posterDataUrl: z.string().max(400_000).nullable(),
});
export type VideoMetadata = z.infer<typeof VideoMetadataSchema>;

/**
 * An audio file.
 *
 * `peaks` is capped at 512 to match `MessageAudioSchema.peaks` exactly, because both feed the same
 * visualizer. The cap is not decorative: a five-minute take captures thousands of samples, and a
 * producer that forgets to resample fails Zod at the boundary rather than at the renderer.
 */
export const AudioMetadataSchema = z.object({
	kind: z.literal("audio"),
	durationMs: z.number().int().min(0),
	durationLabel: z.string().max(12),
	/** Normalised 0..1 envelope, resampled to at most 512 points. */
	peaks: z.array(z.number().min(0).max(1)).max(512),
	sampleRate: z.number().int().positive().nullable(),
	channels: z.number().int().positive().max(32).nullable(),
});
export type AudioMetadata = z.infer<typeof AudioMetadataSchema>;

/**
 * A paged document.
 *
 * Every field is nullable because the whole shape is best-effort: rasterising page 1 needs a PDF
 * reader the browser may not have, and the platform deliberately ships no PDF.js dependency for it.
 * The documented fallback is a row that says so — a null page count with a note — rather than a
 * guessed `1`, which would print a confident sentence about a document nobody read.
 */
export const DocumentMetadataSchema = z.object({
	kind: z.literal("document"),
	/** Page count; `null` when no reader was available. */
	pageCount: z.number().int().positive().nullable(),
	/** First-page raster, or `null` when rasterisation was unavailable. */
	posterDataUrl: z.string().max(400_000).nullable(),
	blurhash: BlurHashSchema.nullable(),
	/** Page 1 pixel size when rasterised. */
	width: z.number().int().positive().nullable(),
	height: z.number().int().positive().nullable(),
});
export type DocumentMetadata = z.infer<typeof DocumentMetadataSchema>;

/**
 * The fallback: the file's type is known, nothing further could be read.
 *
 * A real member of the union rather than an absent branch, so a consumer's `switch` stays exhaustive
 * and "nothing was extracted" is something the row can say out loud.
 */
export const GenericMetadataSchema = z.object({ kind: z.literal("generic") });
export type GenericMetadata = z.infer<typeof GenericMetadataSchema>;

/** Everything an extractor can produce, discriminated on `kind`. */
export const MediaMetadataSchema = z.discriminatedUnion("kind", [
	ImageMetadataSchema,
	VideoMetadataSchema,
	AudioMetadataSchema,
	DocumentMetadataSchema,
	GenericMetadataSchema,
]);
export type MediaMetadata = z.infer<typeof MediaMetadataSchema>;
// #endregion

// #region Envelope
/** Where the extraction ran. */
export const MetadataSource = z.enum(["client", "server"]);
export type MetadataSource = z.infer<typeof MetadataSource>;

/**
 * The envelope actually written to `files.items.metadata`.
 *
 * `version` is a literal rather than a number so a row written by an older producer fails to parse as
 * the current shape instead of half-parsing into it — the point of stamping a version is to be able to
 * identify a stale row, which a permissive `z.number()` would defeat.
 */
export const AssetMetadataSchema = z.object({
	/** Bump when a producer's output shape changes so a stale row is identifiable. */
	version: z.literal(1),
	source: MetadataSource,
	/** ISO instant the extraction completed. */
	extractedAt: z.string(),
	media: MediaMetadataSchema,
	/**
	 * Why a field is absent, when it is. A null blurhash on a 4 GB video and a null blurhash on a
	 * CORS-blocked one are different facts, and a reader that cannot tell them apart will retry the
	 * wrong one forever.
	 */
	notes: z.array(z.string().max(200)).max(8).default([]),
});
export type AssetMetadata = z.infer<typeof AssetMetadataSchema>;

/** The version every producer stamps today — one constant, so a bump is a single edit. */
export const ASSET_METADATA_VERSION = 1;
// #endregion

// #region Duration formatting
/**
 * Format a duration as the clock every player in the product prints.
 *
 * `m:ss` below an hour, which is byte-identical to `MessageAudio.durationLabel` across the entire
 * range a voice memo can occupy, so the composer's clock and an asset row's clock cannot disagree.
 * At or beyond an hour it becomes `h:mm:ss`: a two-hour video reading "120:00" is not a shorter label,
 * it is a wrong-looking one, and audio never reaches that branch so nothing diverges.
 *
 * A negative or non-finite input clamps to zero rather than printing `-1:-1` — a duration that could
 * not be read is a zero-length clock, and it is the caller's `notes` entry that says why.
 */
export function durationLabelOf(ms: number): string {
	const total = Number.isFinite(ms) && ms > 0 ? Math.floor(ms / 1000) : 0;
	const seconds = total % 60;
	const minutes = Math.floor(total / 60) % 60;
	const hours = Math.floor(total / 3600);
	const ss = String(seconds).padStart(2, "0");
	if (hours === 0) return `${minutes}:${ss}`;
	return `${hours}:${String(minutes).padStart(2, "0")}:${ss}`;
}
// #endregion
