/**
 * @projective/ui/display — the showcase grid's pure model.
 *
 * Six 16:10 slots; slot 1 is the cover every card leads with, so it only ever holds a still. A reorder
 * MOVES one filled slot to another filled slot's place: the item leaves the filled sequence and is
 * re-inserted at the target's index, so every filled position stays filled and every gap stays a gap
 * (the same rule the catalogue's `reorderSlots` applies server-side). Nothing here reads the DOM.
 */

// #region Shapes
/** The still painted beneath a slot until it decodes — structurally ProgressiveImage's placeholder. */
export interface ShowcasePlaceholder {
	blurhash?: string | null;
	color?: string | null;
}

/** How many slots a showcase has. */
export const SHOWCASE_GRID_SLOTS = 6;

/** One slot as the grid renders it — structural, so `packages/ui` imports no app schema. */
export interface ShowcaseGridSlot {
	/** 1–6; slot 1 is the cover. */
	position: number;
	kind: "image" | "video";
	/** The 16:10 rendition's tile-sized still (a video's poster). */
	thumb: string;
	alt: string;
	/** The blurhash / ground colour painted until the still decodes. */
	placeholder?: ShowcasePlaceholder | null;
	/** The rendition is still being cut. */
	pending?: boolean;
}

/** Why a move was refused. */
export type ShowcaseMoveRefusal = "same" | "empty" | "out-of-range" | "video-cover";

/** The verdict on one proposed move. */
export type ShowcaseMoveVerdict =
	| { ok: true }
	| { ok: false; reason: ShowcaseMoveRefusal };
// #endregion

// #region Reading
/** The filled positions, ascending. */
export function filledPositions(slots: readonly Pick<ShowcaseGridSlot, "position">[]): number[] {
	return slots.map((s) => s.position).sort((a, b) => a - b);
}

/** The empty positions, ascending. */
export function emptyPositions(slots: readonly Pick<ShowcaseGridSlot, "position">[]): number[] {
	const filled = new Set(slots.map((s) => s.position));
	return Array.from({ length: SHOWCASE_GRID_SLOTS }, (_, i) => i + 1).filter((p) => !filled.has(p));
}

/**
 * The positions an "add" fills, in preference order: the pressed slot first, then every other empty
 * slot ascending — so someone filling their showcase chooses once.
 */
export function addPositions(
	slots: readonly Pick<ShowcaseGridSlot, "position">[],
	pressed: number,
): number[] {
	const empty = emptyPositions(slots);
	return empty.includes(pressed) ? [pressed, ...empty.filter((p) => p !== pressed)] : empty;
}
// #endregion

// #region Moves
/**
 * The reorder as an `order` array: `order[i]` is the OLD position whose item lands in the i-th lowest
 * filled position. This is the payload the catalogue's reorder route takes.
 */
export function reorderedPositions(
	slots: readonly Pick<ShowcaseGridSlot, "position">[],
	from: number,
	to: number,
): number[] {
	const filled = filledPositions(slots);
	const fromIndex = filled.indexOf(from);
	const toIndex = filled.indexOf(to);
	if (fromIndex < 0 || toIndex < 0) return filled;
	const order = filled.filter((p) => p !== from);
	order.splice(toIndex, 0, from);
	return order;
}

/** The slots after a move, each carrying its new position. Positions not filled are untouched. */
export function moveSlots<T extends Pick<ShowcaseGridSlot, "position">>(
	slots: readonly T[],
	from: number,
	to: number,
): T[] {
	const filled = filledPositions(slots);
	const order = reorderedPositions(slots, from, to);
	const byPosition = new Map(slots.map((s) => [s.position, s]));
	return order.map((old, i) => ({ ...byPosition.get(old)!, position: filled[i] }));
}

/**
 * Whether moving the item at `from` onto `to` is allowed. Both must be filled and distinct, and the
 * item that would end up in slot 1 must be an image: dropping a video on the cover is refused, and so
 * is moving the cover away when the item that would slide into slot 1 is a video.
 */
export function legalMove(
	slots: readonly Pick<ShowcaseGridSlot, "position" | "kind">[],
	from: number,
	to: number,
): ShowcaseMoveVerdict {
	const inRange = (p: number) => Number.isInteger(p) && p >= 1 && p <= SHOWCASE_GRID_SLOTS;
	if (!inRange(from) || !inRange(to)) return { ok: false, reason: "out-of-range" };
	if (from === to) return { ok: false, reason: "same" };
	const byPosition = new Map(slots.map((s) => [s.position, s]));
	if (!byPosition.has(from) || !byPosition.has(to)) return { ok: false, reason: "empty" };
	if (byPosition.has(1)) {
		const order = reorderedPositions(slots, from, to);
		const cover = byPosition.get(order[0]);
		if (cover?.kind === "video") return { ok: false, reason: "video-cover" };
	}
	return { ok: true };
}

/** The sentence a refusal is announced with. */
export function refusalMessage(reason: ShowcaseMoveRefusal): string {
	switch (reason) {
		case "video-cover":
			return "The cover is always a picture, so a video can't go in slot 1.";
		case "empty":
			return "Move it onto another filled slot.";
		case "same":
			return "It's already there.";
		case "out-of-range":
			return "There's no slot there.";
	}
}

/**
 * Where a lifted item's keyboard target goes next. ←/↑ step to the previous filled slot, →/↓ to the
 * next, Home/End to the ends; the target never leaves the filled sequence. `null` for any other key.
 */
export function nextMoveTarget(
	filled: readonly number[],
	current: number,
	key: string,
): number | null {
	const i = filled.indexOf(current);
	if (i < 0 || filled.length === 0) return null;
	switch (key) {
		case "ArrowLeft":
		case "ArrowUp":
			return filled[Math.max(0, i - 1)];
		case "ArrowRight":
		case "ArrowDown":
			return filled[Math.min(filled.length - 1, i + 1)];
		case "Home":
			return filled[0];
		case "End":
			return filled[filled.length - 1];
		default:
			return null;
	}
}
// #endregion
