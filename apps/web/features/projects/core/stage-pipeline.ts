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

/** One band as the pane lays it out: one row, however many stages share it. */
export interface BandRow {
	/** Pipeline index of the band's first and last stage. */
	first: number;
	last: number;
	/** The stage that opens the band — what a join onto the row names. */
	opener: string;
	/** The row's block extent: the union of its cards. */
	top: number;
	height: number;
}

/**
 * Where a pointer at `y` lands among the pipeline's band rows: a row's top or bottom edge is the seam
 * before or after its band, its middle joins the band, and a pointer between or beyond the rows takes
 * the nearest seam by the rows' midpoints.
 */
export function bandDropAt(y: number, rows: readonly BandRow[]): PipelineDrop {
	const count = rows.length === 0 ? 0 : rows[rows.length - 1].last + 1;
	const over = rows.find((r) => y >= r.top && y <= r.top + r.height);
	if (over) {
		const zone = cardDropZone(y, over, true);
		if (zone === "join") return { kind: "join", stageId: over.opener };
		return { kind: "seam", before: zone === "before" ? over.first : over.last + 1 };
	}
	const passed = seamAt(y, rows);
	return { kind: "seam", before: passed < rows.length ? rows[passed].first : count };
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

// #region Bands
/** The `[start, end)` index range of the band holding index `at`. */
function bandRange(refs: readonly PipelineSlot[], at: number): [number, number] {
	let start = at;
	while (start > 0 && refs[start].parallel) start--;
	let end = at + 1;
	while (end < refs.length && refs[end].parallel) end++;
	return [start, end];
}

/** The other stages in `stageId`'s band, in order; empty when it runs alone or is absent. */
export function bandMates(refs: readonly PipelineSlot[], stageId: string): string[] {
	const at = refs.findIndex((s) => s.stageId === stageId);
	if (at < 0) return [];
	const [start, end] = bandRange(refs, at);
	return refs.slice(start, end).map((s) => s.stageId).filter((id) => id !== stageId);
}

/**
 * Take `stageId` out of its band and make it a step of its own beside the band it left: before it
 * when it opened the band, after it otherwise, so the partners it leaves keep running together.
 * Returns `null` when it already runs alone.
 */
export function sequentialStage<T extends PipelineSlot>(
	refs: readonly T[],
	stageId: string,
): T[] | null {
	const at = refs.findIndex((s) => s.stageId === stageId);
	if (at < 0) return null;
	const [start, end] = bandRange(refs, at);
	if (end - start <= 1) return null;
	const rest = withoutStage(refs, stageId);
	const index = at === start ? start : end - 1;
	const moved = { ...refs[at], parallel: false };
	return anchored([...rest.slice(0, index), moved, ...rest.slice(index)]);
}

/**
 * Make `stageId`'s band exactly `stageId` and `mates`: a mate not yet in it joins it at its end
 * (healing the band it left), and a partner left out becomes a step of its own beside it. Ids not
 * in the pipeline are ignored. Returns `null` when the band already has that membership.
 */
export function setBandMates<T extends PipelineSlot>(
	refs: readonly T[],
	stageId: string,
	mates: readonly string[],
): T[] | null {
	if (!refs.some((s) => s.stageId === stageId)) return null;
	const want = new Set(
		mates.filter((id) => id !== stageId && refs.some((s) => s.stageId === id)),
	);
	let list: T[] = [...refs];
	for (const id of bandMates(list, stageId)) {
		if (!want.has(id)) list = sequentialStage(list, id) ?? list;
	}
	for (const id of want) {
		if (bandMates(list, stageId).includes(id)) continue;
		const moved = list.find((s) => s.stageId === id);
		if (moved) list = placeStage(list, moved, { kind: "join", stageId }) ?? list;
	}
	return sameShape(list, refs) ? null : list;
}

/** The stage a stage switched to "in parallel" pairs with by default: the one before it, else after. */
export function neighbourOf(refs: readonly PipelineSlot[], stageId: string): string | null {
	const at = refs.findIndex((s) => s.stageId === stageId);
	if (at < 0) return null;
	return refs[at - 1]?.stageId ?? refs[at + 1]?.stageId ?? null;
}
// #endregion
