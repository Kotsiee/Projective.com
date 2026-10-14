import type { ListingMediaSlot } from "@projective/types/catalogue";
import type { MediaRef } from "@projective/types/files";
import { isVideoMedia, mediaPlaceholder, mediaUrl } from "../files/public-media.ts";

/**
 * listing-media — a listing's showcase rows as the slots every surface draws.
 *
 * The seller console (`live-catalogue`) and the public catalogue (`explore/live-catalog`) read the
 * same `catalogue.listing_media` rows, so they map them here once. A slot is drawn from its public
 * 16:10 rendition when one was cut, else from the slot's own file (seeded media is already public).
 * A slot whose picture is not public resolves to nothing and is left out, rather than linking to an
 * object that would 404.
 */

// #region Rows
/** One `catalogue.listing_media` row. */
export interface ListingMediaRow {
	listing_id: string;
	position: number;
	kind: "image" | "video";
	file_id: string;
	rendition_file_id: string | null;
	poster_file_id: string | null;
	alt_text: string | null;
}

/** The columns {@link ListingMediaRow} selects. */
export const LISTING_MEDIA_COLUMNS =
	"listing_id, position, kind, file_id, rendition_file_id, poster_file_id, alt_text";

/** The file ids whose public refs a set of rows needs (`files.get_public_media`). */
export function listingMediaFileIds(rows: readonly ListingMediaRow[]): string[] {
	return [
		...new Set(
			rows.flatMap((r) => [r.rendition_file_id, r.file_id].filter((id): id is string => !!id)),
		),
	];
}
// #endregion

// #region Slots
/**
 * One listing's rows as showcase slots, in position order. Pure: `refs` is the `fetchPublicMedia`
 * answer for {@link listingMediaFileIds}. An image's tile is its `sm` tier and its full view `md`; a
 * video's tile is its poster and its full view the video itself.
 */
export function listingMediaSlots(
	rows: readonly ListingMediaRow[],
	refs: ReadonlyMap<string, MediaRef>,
): ListingMediaSlot[] {
	const slots: ListingMediaSlot[] = [];
	for (const row of [...rows].sort((a, b) => a.position - b.position)) {
		const ref = (row.rendition_file_id ? refs.get(row.rendition_file_id) : undefined) ??
			refs.get(row.file_id);
		if (!ref) continue;
		const video = row.kind === "video" || isVideoMedia(ref);
		const thumb = mediaUrl(ref, video ? "md" : "sm");
		const src = video ? mediaUrl(ref, null) : mediaUrl(ref, "md");
		if (!thumb || !src) continue;
		slots.push({
			position: row.position,
			kind: video ? "video" : "image",
			fileId: row.file_id,
			thumb,
			src,
			alt: row.alt_text ?? "",
			placeholder: mediaPlaceholder(ref),
			width: ref.width ?? undefined,
			height: ref.height ?? undefined,
		});
	}
	return slots;
}

/** Rows grouped by listing id. */
export function mediaRowsByListing(
	rows: readonly ListingMediaRow[],
): Map<string, ListingMediaRow[]> {
	const out = new Map<string, ListingMediaRow[]>();
	for (const row of rows) {
		const list = out.get(row.listing_id) ?? [];
		list.push(row);
		out.set(row.listing_id, list);
	}
	return out;
}
// #endregion
