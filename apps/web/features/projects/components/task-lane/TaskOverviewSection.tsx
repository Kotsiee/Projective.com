import type { JSX } from "preact";
import { Icon } from "@projective/ui/icons";
import { LaneSection } from "@projective/ui/navigation";
import { TaskParty } from "./TaskParty.tsx";
import type { TaskLane } from "../../core/task-lane.ts";
import { type ProjectDetail, STAGE_STATUS_WORD } from "../../types/projects-types.ts";

/**
 * TaskOverviewSection — the Task's key facts: its lifecycle status, when it is due, who owns it, and
 * who holds its ticket.
 *
 * A ledger rather than a card (§B.9.7): the facts rest on the lane surface, labelled in the meta
 * register. The status is the one contained mark, because it is a lifecycle state that changes
 * (§B.11.3); the due date and the owner are plain text. A Task with no date says so rather than
 * leaving the row out, because "no deadline" is a fact the reader came to check.
 *
 * The assignee is the board's, not the roster's: on the live path the participant read is often empty
 * for anyone but the owner, while the ticket names the one person doing the Task. The row is absent
 * until somebody holds the ticket — an unstaffed Task has no assignee to name, and "Unassigned" would be
 * a status the Status row already states.
 */
export interface TaskOverviewSectionProps {
	detail: ProjectDetail;
	lane: TaskLane;
	open: boolean;
	onToggle: () => void;
}

export function TaskOverviewSection(
	{ detail, lane, open, onToggle }: TaskOverviewSectionProps,
): JSX.Element {
	return (
		<LaneSection
			id="task-overview"
			icon={<Icon name="document" />}
			label="Overview"
			open={open}
			onToggle={onToggle}
		>
			<dl class="task-lane__facts">
				<div class="task-lane__fact">
					<dt class="task-lane__term">Status</dt>
					<dd class="task-lane__def">
						<span class="task-lane__status" data-status={detail.status}>
							<span class="task-lane__status-dot" aria-hidden="true" />
							{STAGE_STATUS_WORD[detail.status]}
						</span>
					</dd>
				</div>
				<div class="task-lane__fact">
					<dt class="task-lane__term">Due</dt>
					<dd class="task-lane__def">
						{lane.dueLabel
							? (
								<time class="task-lane__due" dateTime={lane.dueAt ?? undefined}>
									{lane.dueLabel}
								</time>
							)
							: <span class="task-lane__none">No due date</span>}
					</dd>
				</div>
				<div class="task-lane__fact">
					<dt class="task-lane__term">Owner</dt>
					<dd class="task-lane__def">
						<TaskParty party={detail.owner} />
					</dd>
				</div>
				{lane.ticket?.assignee && (
					<div class="task-lane__fact">
						<dt class="task-lane__term">Assigned</dt>
						<dd class="task-lane__def">
							<TaskParty party={lane.ticket.assignee} />
						</dd>
					</div>
				)}
			</dl>
		</LaneSection>
	);
}
