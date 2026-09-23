import type { JSX } from "preact";
import { LaneSections } from "@projective/ui/navigation";
import { TaskOverviewSection } from "./TaskOverviewSection.tsx";
import { TaskListsSection } from "./TaskListsSection.tsx";
import { TaskMembersSection } from "./TaskMembersSection.tsx";
import { taskCollaborators, type TaskLane } from "../../core/task-lane.ts";
import type { ProjectDetail } from "../../types/projects-types.ts";

/**
 * TaskLanePanel — the Project Details lane's body for a Task, in place of the channel tree.
 *
 * A Task has one conversation (reached through the Discussion view link), so a navigator over
 * conversations would have nothing to switch between. The lane spends that space on what a Task's
 * reader actually checks: its status, due date and owner; its task lists; and who is working on it.
 * Each is its own collapsible {@link LaneSection}, sharing the open-state map the channel tree used, so
 * a reader's collapsed sections survive a navigation exactly as its groups did.
 *
 * Presentation only: the island owns the open-state, and the {@link TaskLane} is the server's
 * projection of the board (or its empty form while an unsaved form says Task).
 */
export interface TaskLanePanelProps {
	/** The engagement as the lane draws it — the draft folded on. */
	detail: ProjectDetail;
	lane: TaskLane;
	/** The current page, for the ticket link's `?tkv=`. */
	path: string;
	openGroups: Record<string, boolean>;
	onToggleGroup: (key: string) => void;
}

export function TaskLanePanel(
	{ detail, lane, path, openGroups, onToggleGroup }: TaskLanePanelProps,
): JSX.Element {
	const open = (key: string) => !!openGroups[key];
	return (
		<LaneSections class="task-lane">
			<TaskOverviewSection
				detail={detail}
				lane={lane}
				open={open("task-overview")}
				onToggle={() => onToggleGroup("task-overview")}
			/>
			<TaskListsSection
				lane={lane}
				path={path}
				open={open("task-lists")}
				onToggle={() => onToggleGroup("task-lists")}
			/>
			<TaskMembersSection
				people={taskCollaborators(detail.members, lane.ticket?.assignee ?? null)}
				membersHref={`/projects/${detail.slug}/members`}
				open={open("task-members")}
				onToggle={() => onToggleGroup("task-members")}
			/>
		</LaneSections>
	);
}
