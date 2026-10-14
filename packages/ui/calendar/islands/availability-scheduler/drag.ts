import { clamp, DAY_MINUTES, snapTo, weekColumns } from "./civil.ts";
import type { SchedulerAction, Selection } from "./reducer.ts";
import type { Band, Layer, Weekday } from "./types.ts";

// #region Types
/** What a pointer drag on the week canvas does. */
export type DragKind = "create" | "move" | "copy" | "start" | "end";

/** A pointer position in grid terms. */
export interface DragPoint {
	day: Weekday;
	minute: number;
}

/** A drag as it began. `sel` and `band` are set for every kind but `create`. */
export interface DragSpec {
	kind: DragKind;
	origin: DragPoint;
	layer: Layer;
	sel?: Selection;
	band?: Band;
}

/** One piece of the drag ghost. */
export interface GhostPart {
	day: Weekday;
	band: Band;
	layer: Layer;
}

/** What the drag would do if released now. */
export interface DragOutcome {
	ghost: GhostPart[];
	action: SchedulerAction | null;
}
// #endregion

// #region Outcome
function createOutcome(
	spec: DragSpec,
	at: DragPoint,
	snap: number,
	weekStartsOn: number,
): DragOutcome {
	const columns = weekColumns(weekStartsOn);
	const from = columns.indexOf(spec.origin.day);
	const to = columns.indexOf(at.day);
	let start: number;
	let end: number;
	if (to > from) {
		start = snapTo(spec.origin.minute, snap);
		end = DAY_MINUTES + (to > from + 1 ? DAY_MINUTES : snapTo(at.minute, snap));
		end = Math.min(end, start + DAY_MINUTES);
	} else {
		start = snapTo(Math.min(spec.origin.minute, at.minute), snap);
		end = snapTo(Math.max(spec.origin.minute, at.minute), snap);
	}
	start = clamp(start, 0, DAY_MINUTES - snap);
	if (end - start < snap) end = start + snap;

	const day = spec.origin.day;
	const ghost: GhostPart[] = [{
		day,
		band: { start, end: Math.min(end, DAY_MINUTES) },
		layer: spec.layer,
	}];
	if (end > DAY_MINUTES) {
		ghost.push({
			day: ((day + 1) % 7) as Weekday,
			band: { start: 0, end: end - DAY_MINUTES },
			layer: spec.layer,
		});
	}
	return { ghost, action: { type: "createBand", day, start, end } };
}

/**
 * The ghost and the action of a drag from `spec.origin` to `at`, snapped to `snap` minutes. Dragging
 * a new band into the next day's column is an overnight drag: it ends on that day and the reducer
 * stores it as two bands.
 */
export function dragOutcome(
	spec: DragSpec,
	at: DragPoint,
	snap: number,
	weekStartsOn: number,
): DragOutcome {
	if (spec.kind === "create") return createOutcome(spec, at, snap, weekStartsOn);
	const { sel, band, layer } = spec;
	if (!sel || !band) return { ghost: [], action: null };
	const length = band.end - band.start;

	switch (spec.kind) {
		case "move": {
			const start = clamp(
				snapTo(band.start + at.minute - spec.origin.minute, snap),
				0,
				DAY_MINUTES - length,
			);
			const minutes = start - band.start;
			const unchanged = minutes === 0 && at.day === sel.day;
			return {
				ghost: [{ day: at.day, band: { start, end: start + length }, layer }],
				action: unchanged ? null : { type: "moveBand", ...sel, toDay: at.day, minutes },
			};
		}
		case "copy":
			return at.day === sel.day ? { ghost: [], action: null } : {
				ghost: [{ day: at.day, band, layer }],
				action: { type: "duplicateBand", ...sel, toDay: at.day },
			};
		case "start": {
			const start = clamp(snapTo(at.minute, snap), 0, band.end - snap);
			return {
				ghost: [{ day: sel.day, band: { start, end: band.end }, layer }],
				action: start === band.start
					? null
					: { type: "resizeBand", ...sel, edge: "start", minutes: start - band.start },
			};
		}
		case "end": {
			const end = clamp(snapTo(at.minute, snap), band.start + snap, DAY_MINUTES);
			return {
				ghost: [{ day: sel.day, band: { start: band.start, end }, layer }],
				action: end === band.end
					? null
					: { type: "resizeBand", ...sel, edge: "end", minutes: end - band.end },
			};
		}
	}
}
// #endregion
