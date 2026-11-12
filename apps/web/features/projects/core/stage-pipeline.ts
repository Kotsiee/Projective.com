/**
 * stage-pipeline — the pure reducers and drop geometry behind the ticket modal's stage pane.
 *
 * Generic over any `{ stageId, parallel }` slot, so the same rules serve the ticket's
 * `TicketStageRef`s and any lighter projection a test or a preview needs. Every reducer returns a new
 * list, or `null` when the request would change nothing, so a drop that lands where it started never
 * dirties the working copy.
 *
 * Bands follow `executionBands`: a slot with `parallel: true` runs alongside the slot before it. A
 * reducer that takes a band's opener out promotes the next member to open it, so the stages left
 * behind keep running together instead of silently joining whatever preceded them.
 *
 * @module
 */

// #region Types
/** The two facts about a stage slot these reducers read and rewrite. */
export interface PipelineSlot {
	stageId: string;
	parallel: boolean;
}

/**
 * Where a dragged stage lands in the pipeline.
 *
 * `seam` inserts before the slot currently at `before` (`before === length` appends). `join` puts the
 * stage at the end of `stageId`'s band, running alongside it. `exclude` takes it out of the ticket.
 */
export type PipelineDrop =
	| { kind: "seam"; before: number }
	| { kind: "join"; stageId: string }
	| { kind: "exclude" };

/** Which part of a target card the pointer is over. */
export type CardDropZone = "before" | "join" | "after";
// #endregion

// #region Geometry
/** Share of a card's height, at each edge, that reads as "between" rather than "onto". */
export const SEAM_EDGE = 0.3;

/**
 * Which part of a target card a pointer at `y` is over: its top edge inserts before it, its bottom
 * edge after it, and the middle joins its band. A card that cannot be joined splits at its midpoint.
 */
export function cardDropZone(
	y: number,
	rect: { top: number; height: number },
	joinable: boolean,
): CardDropZone {
	const at = rect.height > 0 ? (y - rect.top) / rect.height : 0.5;
	if (!joinable) return at < 0.5 ? "before" : "after";
	if (at < SEAM_EDGE) return "before";
	if (at > 1 - SEAM_EDGE) return "after";
	return "join";
}

/** The seam a pointer at `y` falls in, given each slot's rect in pipeline order. */
export function seamAt(y: number, rects: readonly { top: number; height: number }[]): number {
	let before = 0;
	for (const r of rects) {
		if (y > r.top + r.height / 2) before++;
	}
	return before;
}
// #endregion

// #region Reducers
const sameShape = (a: readonly PipelineSlot[], b: readonly PipelineSlot[]): boolean =>
	a.length === b.length &&
	a.every((s, i) => s.stageId === b[i].stageId && s.parallel === b[i].parallel);

const anchored = <T extends PipelineSlot>(list: T[]): T[] =>
	list.map((s, i) => (i === 0 && s.parallel ? { ...s, parallel: false } : s));

/** The list without `stageId`, its band healed: an opener's next member opens the band instead. */
export function withoutStage<T extends PipelineSlot>(refs: readonly T[], stageId: string): T[] {
	const at = refs.findIndex((s) => s.stageId === stageId);
	if (at < 0) return [...refs];
	const next = refs.filter((_, i) => i !== at);
	const opener = !refs[at].parallel;
	if (opener && at < next.length && next[at].parallel) next[at] = { ...next[at], parallel: false };
	return anchored(next);
}

/**
 * Place `moved` — a stage already in the list, or one being added — where `drop` says.
 *
 * A seam between two bands makes the stage its own step; a seam inside a band joins it, so dropping
 * between two stages that run together never splits them. Returns `null` when nothing changes.
 */
export function placeStage<T extends PipelineSlot>(
	refs: readonly T[],
	moved: T,
	drop: PipelineDrop,
): T[] | null {
	if (drop.kind === "exclude") {
		if (!refs.some((s) => s.stageId === moved.stageId)) return null;
		return withoutStage(refs, moved.stageId);
	}
	const rest = withoutStage(refs, moved.stageId);
	let index: number;
	let parallel: boolean;
	if (drop.kind === "join") {
		if (drop.stageId === moved.stageId) return null;
		const target = rest.findIndex((s) => s.stageId === drop.stageId);
		if (target < 0) return null;
		index = target + 1;
		while (index < rest.length && rest[index].parallel) index++;
		parallel = true;
	} else {
		const before = Math.max(0, Math.min(refs.length, drop.before));
		index = refs.slice(0, before).filter((s) => s.stageId !== moved.stageId).length;
		parallel = index > 0 && index < rest.length && rest[index].parallel;
	}
	const next = anchored([...rest.slice(0, index), { ...moved, parallel }, ...rest.slice(index)]);
	return sameShape(next, refs) ? null : next;
}

/**
 * Swap a stage with its neighbour, keeping the pipeline's shape: the concurrency flags stay with the
 * slots, so a two-stage band stays a two-stage band and only which stages fill it changes.
 */
export function swapStage<T extends PipelineSlot>(
	refs: readonly T[],
	stageId: string,
	direction: -1 | 1,
): T[] | null {
	const at = refs.findIndex((s) => s.stageId === stageId);
	const to = at + direction;
	if (at < 0 || to < 0 || to >= refs.length) return null;
	const next = refs.slice();
	next[at] = { ...refs[to], parallel: refs[at].parallel };
	next[to] = { ...refs[at], parallel: refs[to].parallel };
	return anchored(next);
}
// #endregion
