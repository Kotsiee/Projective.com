import type { ComponentChildren } from "preact";
import type { UserContext } from "@projective/types/auth";
import TimelineControlRig from "../islands/TimelineControlRig.island.tsx";

/**
 * timeline-footer-slot — the SSR-idiomatic resolver for the Timeline / Gantt's action rig in the
 * middle-nav FOOTER band. It mirrors {@link boardFooterFor} and is composed right after it in the
 * `(dashboard)` layout, so exactly one footer wins per URL: the timeline rig on the project timeline
 * (`/projects/[id]/timeline`) or a stage's timeline (`/projects/[id]/[channel]/timeline`), else
 * `null`. Like the sibling resolvers it needs no project detail — the rig is a dumb island driving
 * the shared timeline signals — so it stays a pure URL match.
 */
export function timelineFooterFor(url: URL, _context: UserContext): ComponentChildren {
	const segs = url.pathname.split("/").filter(Boolean); // ["projects", id, ...]
	if (segs[0] !== "projects" || segs[1] === "create") return null;

	const isProjectTimeline = segs.length === 3 && segs[2] === "timeline";
	const isStageTimeline = segs.length === 4 && segs[3] === "timeline";
	if (!isProjectTimeline && !isStageTimeline) return null;

	return <TimelineControlRig />;
}
