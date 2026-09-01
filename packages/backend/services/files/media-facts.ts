import type { AssetItem, AssetMetadata } from "@projective/types/files";

/**
 * media-facts — the projection from a stored {@link AssetMetadata} envelope onto the flat fields
 * `AssetItemSchema` already carries.
 *
 * The browser reads a file's bytes once, at upload time, and hands the result over with the completion
 * call. Everything downstream — a grid cell's aspect box, a table row's duration column, a preview's
 * poster — reads the asset row rather than re-decoding a 200 MB file to answer a question that was
 * already answered. That only works if the row is populated from the envelope, which is what this does.
 *
 * ## An unread field never overwrites a stored one
 *
 * {@link applyMediaFacts} overlays only what the extraction actually ANSWERED. A browser that could not
 * decode an image reports `null` dimensions, and a null that blanked a width the row already held would
 * turn a degraded read into data loss — the whole point of modelling every absence separately
 * (`metadata.ts`) is that "not read" and "not there" stay distinguishable, and a merge that treats them
 * alike throws that away at the last step.
 *
 * ## The poster is a `data:` URL and `thumbnailUrl` is a 2000-character column
 *
 * `VideoMetadataSchema.posterDataUrl` is bounded at 400,000 characters because a JPEG frame is large;
 * `AssetItemSchema.thumbnailUrl` is bounded at 2,000 because it is an address. A base64 poster of any
 * real frame does not fit, and writing one anyway would produce a row that fails its own schema at
 * whichever boundary happens to re-parse it — a silent over-long field is exactly the class of defect
 * a declared bound exists to catch. So a poster is adopted as a thumbnail only when it genuinely fits,
 * and otherwise stays where it belongs: in `files.items.metadata`, which is sized for it.
 *
 * Pure, synchronous and dependency-free, so the live path and the fixture path derive the same fields
 * from the same envelope. Two implementations would be two chances for the grid to disagree with the
 * preview about how big a picture is.
 */

// #region Bounds
/**
 * The longest value `AssetItemSchema.thumbnailUrl` accepts.
 *
 * Restated from the SSOT rather than imported because Zod does not expose a schema's `max` as a
 * readable number; it is asserted against the schema in the fat service's own tests.
 */
const THUMBNAIL_MAX_CHARS = 2000;
// #endregion

// #region The projection
/**
 * The flat asset fields a metadata envelope can answer.
 *
 * `null` in every position means "the extraction did not answer this", never "this asset has none" —
 * see {@link applyMediaFacts} for what a caller must do with the distinction.
 */
export interface MediaFacts {
	width: number | null;
	height: number | null;
	durationLabel: string | null;
	thumbnailUrl: string | null;
}

/** Nothing was answered. The shape a `generic` envelope, or no envelope at all, produces. */
const NOTHING: MediaFacts = { width: null, height: null, durationLabel: null, thumbnailUrl: null };

/**
 * A poster, if it is short enough to live in a URL column. See the module note.
 *
 * The bound is genuinely load-bearing rather than defensive: a 640px frame does not fit and a small
 * one does, so this decides rather than merely guards.
 */
function posterAsThumbnail(posterDataUrl: string | null): string | null {
	if (posterDataUrl === null) return null;
	return posterDataUrl.length <= THUMBNAIL_MAX_CHARS ? posterDataUrl : null;
}

/**
 * Read the flat facts out of an extraction envelope.
 *
 * An absent or `generic` envelope answers nothing, which is the honest result for a file whose type is
 * known and whose bytes hold nothing a browser can read.
 */
export function mediaFactsFrom(metadata: AssetMetadata | null | undefined): MediaFacts {
	if (!metadata) return NOTHING;
	const media = metadata.media;
	switch (media.kind) {
		case "image":
			return {
				width: media.width,
				height: media.height,
				durationLabel: null,
				thumbnailUrl: null,
			};
		case "video":
			return {
				width: media.width,
				height: media.height,
				durationLabel: media.durationLabel,
				thumbnailUrl: posterAsThumbnail(media.posterDataUrl),
			};
		case "audio":
			// No dimensions, deliberately: an audio file has none, and a waveform is not a picture size.
			return {
				width: null,
				height: null,
				durationLabel: media.durationLabel,
				thumbnailUrl: null,
			};
		case "document":
			return {
				width: media.width,
				height: media.height,
				durationLabel: null,
				thumbnailUrl: posterAsThumbnail(media.posterDataUrl),
			};
		case "generic":
			return NOTHING;
	}
}

/**
 * Overlay everything the extraction answered onto an asset row, leaving the rest untouched.
 *
 * The merge is one-directional on purpose. A field the extraction READ replaces whatever the row was
 * carrying, because the row's value was a placeholder minted before anyone had looked at the bytes and
 * the extraction's value is a measurement of the actual file. A field it did NOT read changes nothing,
 * because a browser that could not decode a photograph has not discovered that the photograph has no
 * dimensions — it has discovered that this browser cannot read them, and the reason is already
 * recorded in `metadata.notes`.
 */
export function applyMediaFacts(
	item: AssetItem,
	metadata: AssetMetadata | null | undefined,
): AssetItem {
	const facts = mediaFactsFrom(metadata);
	const next: AssetItem = {
		...item,
		width: facts.width ?? item.width,
		height: facts.height ?? item.height,
		durationLabel: facts.durationLabel ?? item.durationLabel,
		thumbnailUrl: facts.thumbnailUrl ?? item.thumbnailUrl,
	};
	// The envelope itself rides along beside the flattened facts, because the half that cannot be
	// flattened is the half the grid needs first: a BlurHash is what stands in for the image while the
	// image loads, and a poster frame is a `data:` URL two orders of magnitude longer than
	// `thumbnailUrl` accepts.
	//
	// Written conditionally rather than through `??`, because `undefined` and `null` are different
	// answers here and `??` would fold them together. Absent means no extraction was supplied, and the
	// key must stay ABSENT — materialising `metadata: undefined` would turn "nobody looked" into a
	// recorded answer. An explicit `null` means a client reached for the bytes and could not read
	// them, which is worth storing: it is what stops the pipeline retrying a file that will never
	// decode.
	if (metadata !== undefined) next.metadata = metadata;
	return next;
}
// #endregion
