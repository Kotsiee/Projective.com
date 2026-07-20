import type { DndCollisionArgs, DndCollisionDetector, DndData, DndId, DndPoint } from "./types.ts";

/**
 * Collision detectors — pure functions that pick the droppable currently under a drag. All exclude the
 * active node itself and any droppable that does not `accept` the active drag `type`, so a card only
 * targets card/column droppables and a column only targets column droppables (Kanban self-sorting).
 */

// #region Helpers
/** Whether a droppable accepts the given drag `type` (no `accepts` list = accepts anything). */
function accepts(data: DndData, type: string | undefined): boolean {
	if (!data.accepts) return true;
	if (type === undefined) return true;
	return data.accepts.includes(type);
}

function contains(r: DOMRect, p: DndPoint): boolean {
	return p.x >= r.left && p.x <= r.right && p.y >= r.top && p.y <= r.bottom;
}

function centerDistance(r: DOMRect, p: DndPoint): number {
	const cx = r.left + r.width / 2;
	const cy = r.top + r.height / 2;
	return Math.hypot(cx - p.x, cy - p.y);
}

/** The eligible droppables for an active drag (not self, not disabled, accepts the drag type). */
function eligible(args: DndCollisionArgs) {
	const type = args.active.data.type;
	const out: { id: DndId; rect: DOMRect }[] = [];
	for (const d of args.droppables) {
		if (d.disabled || d.id === args.active.id || !accepts(d.data, type)) continue;
		const rect = d.getRect();
		if (rect) out.push({ id: d.id, rect });
	}
	return out;
}
// #endregion

// #region Detectors
/**
 * The droppable whose rect contains the pointer, preferring the SMALLEST-area match — so an inner card
 * target wins over its enclosing column, giving fine-grained insertion while the column still catches
 * drops in its empty gutters.
 */
export const pointerWithin: DndCollisionDetector = (args) => {
	let best: DndId | null = null;
	let bestArea = Infinity;
	for (const { id, rect } of eligible(args)) {
		if (!contains(rect, args.pointer)) continue;
		const area = rect.width * rect.height;
		if (area < bestArea) {
			bestArea = area;
			best = id;
		}
	}
	return best;
};

/** The droppable whose centre is nearest the pointer (used as a fallback when over no rect). */
export const closestCenter: DndCollisionDetector = (args) => {
	let best: DndId | null = null;
	let bestDist = Infinity;
	for (const { id, rect } of eligible(args)) {
		const d = centerDistance(rect, args.pointer);
		if (d < bestDist) {
			bestDist = d;
			best = id;
		}
	}
	return best;
};

/**
 * The default: pointer-within (fine-grained), falling back to closest-centre when the pointer has left
 * every rect (e.g. dragged into the board gutter) so a drop still resolves to the nearest target.
 */
export const defaultCollision: DndCollisionDetector = (args) =>
	pointerWithin(args) ?? closestCenter(args);
// #endregion

// #region Keyboard direction
export type DndDirection = "up" | "down" | "left" | "right";

/**
 * The nearest eligible droppable from `fromId` in a cardinal direction — the keyboard sensor's move
 * model. Ranks candidates whose centre lies in the pressed direction by primary-axis distance, so
 * Arrow keys step between columns (left/right) and cards (up/down) predictably.
 */
export function nextInDirection(
	fromId: DndId | null,
	dir: DndDirection,
	args: DndCollisionArgs,
): DndId | null {
	const list = eligible(args);
	if (list.length === 0) return null;
	const fromRect = fromId
		? list.find((d) => d.id === fromId)?.rect ?? args.active.rect
		: args.active.rect;
	const from: DndPoint = {
		x: fromRect.left + fromRect.width / 2,
		y: fromRect.top + fromRect.height / 2,
	};

	let best: DndId | null = null;
	let bestScore = Infinity;
	for (const { id, rect } of list) {
		if (id === fromId) continue;
		const cx = rect.left + rect.width / 2;
		const cy = rect.top + rect.height / 2;
		const dx = cx - from.x;
		const dy = cy - from.y;
		const inDir = dir === "up"
			? dy < -1
			: dir === "down"
			? dy > 1
			: dir === "left"
			? dx < -1
			: dx > 1;
		if (!inDir) continue;
		// Primary-axis distance weighted heavier so a same-row/column neighbour wins over a diagonal.
		const primary = dir === "up" || dir === "down" ? Math.abs(dy) : Math.abs(dx);
		const cross = dir === "up" || dir === "down" ? Math.abs(dx) : Math.abs(dy);
		const score = primary + cross * 2;
		if (score < bestScore) {
			bestScore = score;
			best = id;
		}
	}
	return best;
}
// #endregion
