import type { JSX } from "preact";
import { Gantt } from "@projective/ui/gantt";
import { Button } from "@projective/ui/fields";
import {
	type BoardCard,
	type BoardStageRef,
	buildTicketTimeline,
} from "../../../types/projects-types.ts";
import { timelineItemOf, toGanttItem, toGanttLane } from "../../../core/timeline-model.ts";

import "../../../styles/timeline.css";

/**
 * TicketTimelineTab — the ticket's stage run on a time axis.
 *
 * One lane per stage the ticket requires, in the ticket's own order, each carrying the LIVE stage's
 * scheduled window and a step number derived from the execution bands (two stages that start
 * together read as one step, joined by their links), then a trailing lane for the ticket's own
 * claim-to-deadline span. The lanes and items come from the Zod SSOT's `buildTicketTimeline`, which
 * never invents a date: an unscheduled stage keeps its lane and draws nothing.
 *
 * Read-only by construction — a ticket's schedule is configured on the stages, not here — so the
 * engine offers no drag-to-create and no drag-to-move; the one action a stage's popover carries is
 * the jump to the Stages tab, where that stage is configured.
 */
export interface TicketTimelineTabProps {
	card: BoardCard;
	/** The engagement's live stages, for the windows the ticket never captured. */
	stages: BoardStageRef[];
	/** The reference instant ("today"), epoch ms. Absent → the real clock. */
	now?: number;
	/** Open a stage in the modal's Stages tab + inspector. */
	onOpenStage: (stageId: string) => void;
}

export function TicketTimelineTab(props: TicketTimelineTabProps): JSX.Element {
	const nowMs = props.now ?? Date.now();
	const tl = buildTicketTimeline(props.card, props.stages, { nowMs });
	const lanes = tl.lanes.map(toGanttLane);
	const items = tl.items.map(toGanttItem);
	// Open on the middle of the run when there is one, else on today — a viewport centred on a
	// distant "now" with every bar off-screen would open on an empty grid.
	const focus = tl.range ? (Date.parse(tl.range.start) + Date.parse(tl.range.end)) / 2 : nowMs;

	return (
		<div class="tkv-timeline">
			<Gantt
				lanes={lanes}
				items={items}
				now={nowMs}
				focus={focus}
				readOnly
				laneHeading="Stages"
				ariaLabel="Ticket timeline"
				renderItemActions={(ctx) => {
					const wire = timelineItemOf(ctx.item);
					if (!wire || wire.subject !== "stage" || !wire.stageId) return null;
					const stageId = wire.stageId;
					return (
						<Button
							size="sm"
							variant="text"
							onClick={() => {
								ctx.close();
								props.onOpenStage(stageId);
							}}
						>
							Open stage
						</Button>
					);
				}}
				empty={<p class="tl-empty">This ticket requires no stages yet.</p>}
			/>
		</div>
	);
}
