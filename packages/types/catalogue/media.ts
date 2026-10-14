import { z } from "zod";
import { CropStateSchema } from "../files/crop.ts";
import { ImagePlaceholderSchema } from "../files/metadata.ts";
import { SHOWCASE_SLOTS } from "../profile/profile.ts";

export { SHOWCASE_SLOTS } from "../profile/profile.ts";

/**
 * catalogue.media — a listing's six-slot media showcase (Decision #217(e)), the same grid the
 * profile showcase uses.
 *
 * Every slot is a library file (no URL media): slot 1 is the cover and must be a still, slots 2–6
 * may also hold video. Positions are 1-based and may be sparse — an empty position renders as an
 * empty slot rather than shifting its neighbours.
 */

// #region Slots
/** A showcase position, 1–6. Position 1 is the cover. */
export const ListingMediaPosition = z.number().int().min(1).max(SHOWCASE_SLOTS);

/** Whether a slot holds a still or a video. */
export const ListingMediaKind = z.enum(["image", "video"]);
export type ListingMediaKind = z.infer<typeof ListingMediaKind>;

/** One filled showcase slot as the workspace reads it (`catalogue.listing_media`). */
export const ListingMediaSlotSchema = z.object({
	position: ListingMediaPosition,
	kind: ListingMediaKind,
	/** The slot's library file — what a save refers to. */
	fileId: z.string().uuid(),
	/** The 16:10 tile still: the image's rendition, or a video's poster. */
	thumb: z.string().max(600),
	/** The full-size source the public page plays or shows. */
	src: z.string().max(600),
	alt: z.string().max(200),
	placeholder: ImagePlaceholderSchema.optional(),
	/** The stored item's measured pixel size, when known (a product card sizes its tile from it). */
	width: z.number().int().positive().optional(),
	height: z.number().int().positive().optional(),
	/** The 16:10 rendition is still being cut. */
	pending: z.boolean().optional(),
});
export type ListingMediaSlot = z.infer<typeof ListingMediaSlotSchema>;

function uniquePositions(positions: readonly number[], ctx: z.RefinementCtx): void {
	const seen = new Set<number>();
	positions.forEach((position, index) => {
		if (seen.has(position)) {
			ctx.addIssue({
				code: "custom",
				message: "Each slot can hold only one item.",
				path: [index, "position"],
			});
		}
		seen.add(position);
	});
}

/** A listing's showcase: at most six slots, one item per position, and a still in slot 1. */
export const ListingMediaSlotsSchema = z.array(ListingMediaSlotSchema).max(SHOWCASE_SLOTS)
	.superRefine((slots, ctx) => {
		uniquePositions(slots.map((s) => s.position), ctx);
		slots.forEach((slot, index) => {
			if (slot.position === 1 && slot.kind !== "image") {
				ctx.addIssue({
					code: "custom",
					message: "The cover must be an image.",
					path: [index, "kind"],
				});
			}
		});
	});

/** The cover slot (position 1, a still), or `null` when the showcase has none. */
export function coverOf<T extends Pick<ListingMediaSlot, "position" | "kind">>(
	slots: readonly T[],
): T | null {
	return slots.find((s) => s.position === 1 && s.kind === "image") ?? null;
}
// #endregion

// #region Mutation payloads
/**
 * One library asset placed into a slot. The server re-reads the asset under the caller's session,
 * cuts the 16:10 rendition (clamping `crop` to the decoded pixels) and refuses a video in slot 1.
 */
export const MediaChoiceSchema = z.object({
	sourceAssetId: z.string().uuid(),
	position: ListingMediaPosition,
	alt: z.string().max(200).default(""),
	crop: CropStateSchema.optional(),
});
export type MediaChoice = z.infer<typeof MediaChoiceSchema>;

/** Place up to six library assets into a listing's showcase (`POST /api/catalogue/media`). */
export const ApplyListingMediaSchema = z.object({
	listingId: z.string().min(1).max(120),
	choices: z.array(MediaChoiceSchema).min(1).max(SHOWCASE_SLOTS)
		.superRefine((choices, ctx) => uniquePositions(choices.map((c) => c.position), ctx)),
});
export type ApplyListingMediaInput = z.infer<typeof ApplyListingMediaSchema>;

/**
 * Reorder a listing's showcase (`POST /api/catalogue/media/reorder`). `order` lists the CURRENT
 * positions of the filled slots in their new order; see {@link reorderSlots}.
 */
export const ReorderListingMediaSchema = z.object({
	listingId: z.string().min(1).max(120),
	order: z.array(ListingMediaPosition).min(1).max(SHOWCASE_SLOTS)
		.superRefine((order, ctx) => {
			if (new Set(order).size !== order.length) {
				ctx.addIssue({ code: "custom", message: "A slot can appear only once." });
			}
		}),
});
export type ReorderListingMediaInput = z.infer<typeof ReorderListingMediaSchema>;
// #endregion

// #region Reorder
/** The outcome of applying a reorder to a showcase. */
export type ReorderResult<T = ListingMediaSlot> =
	| { ok: true; slots: T[] }
	| { ok: false; reason: string };

/**
 * Apply a reorder. The filled positions stay filled (gaps stay gaps): the slot listed at `order[i]`
 * moves to the i-th lowest filled position. Refused when `order` is not a permutation of the filled
 * positions, or when it would put a video in the cover slot.
 */
export function reorderSlots<T extends Pick<ListingMediaSlot, "position" | "kind">>(
	slots: readonly T[],
	order: readonly number[],
): ReorderResult<T> {
	const filled = slots.map((s) => s.position).sort((a, b) => a - b);
	const sameSet = order.length === filled.length && new Set(order).size === order.length &&
		order.every((p) => filled.includes(p));
	if (!sameSet) return { ok: false, reason: "The new order must list every filled slot once." };
	const byPosition = new Map(slots.map((s) => [s.position, s]));
	const next: T[] = [];
	order.forEach((from, index) => {
		const slot = byPosition.get(from);
		if (slot) next.push({ ...slot, position: filled[index] });
	});
	if (next.some((s) => s.position === 1 && s.kind !== "image")) {
		return { ok: false, reason: "A video can't be the cover. Slot 1 must be an image." };
	}
	return { ok: true, slots: next };
}
// #endregion
