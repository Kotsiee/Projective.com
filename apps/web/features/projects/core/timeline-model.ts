import type { GanttItem, GanttLane } from "@projective/ui/gantt";
import type { TimelineItem, TimelineLane } from "../types/projects-types.ts";

/**
 * timeline-model — the pure, DOM-free mapping from the Zod timeline projection
 * (`@projective/types/projects` `TimelineLane`/`TimelineItem`, ISO strings on the wire) onto the
 * portable Gantt engine's zod-free shapes (`GanttLane`/`GanttItem`, epoch ms). Both the project
 * timeline island and the ticket modal's Timeline tab go through it, so an item's accent, its
 * progress channel and its accessible words are translated in exactly one place.
 */

// #region Lanes + items
/** A wire lane onto an engine lane. */
export function toGanttLane(lane: TimelineLane): GanttLane {
	return {
		id: lane.id,
		label: lane.label,
		sublabel: lane.sublabel ?? undefined,
		accent: lane.accent ?? undefined,
		depth: lane.depth,
		meta: lane.meta ?? undefined,
		avatar: lane.avatar ? { name: lane.avatar.name, url: lane.avatar.url } : undefined,
		creatable: lane.creatable,
	};
}

/** A wire item onto an engine item. The wire item rides along as `data` so a callback can route on it. */
export function toGanttItem(item: TimelineItem): GanttItem {
	return {
		id: item.id,
		laneId: item.laneId,
		label: item.label,
		kind: item.kind,
		start: Date.parse(item.start),
		end: Date.parse(item.end),
		accent: item.accent ?? undefined,
		progress: item.progress,
		dependsOn: item.dependsOn,
		meta: item.meta ?? undefined,
		status: item.status ?? undefined,
		movable: item.movable,
		data: item,
	};
}

/** The wire item an engine item was built from, or `null` for an item this feature did not build. */
export function timelineItemOf(item: GanttItem): TimelineItem | null {
	const data = item.data as TimelineItem | undefined;
	return data && typeof data === "object" && "subject" in data ? data : null;
}
// #endregion

// #region Tier words
/** The word the footer rig prints for the header's bottom time unit. */
const TIER_WORD: Record<string, string> = {
	hour: "Hours",
	day: "Days",
	week: "Weeks",
	month: "Months",
	quarter: "Quarters",
	year: "Years",
};

/** "Weeks" for `week`; an unknown unit is printed as itself rather than dropped. */
export function tierWord(unit: string): string {
	return TIER_WORD[unit] ?? unit;
}
// #endregion
