import type { JSX } from "preact";
import { LaneSections } from "@projective/ui/navigation";
import { TaskOverviewSection } from "./TaskOverviewSection.tsx";
import { TaskListsSection } from "./TaskListsSection.tsx";
import type { TaskLane } from "../../core/task-lane.ts";
import type { ProjectDetail } from "../../types/projects-types.ts";

/**
 * TaskLanePanel — the Project Details lane's body for a Task, in place of the channel tree.
 *
 * A Task has one conversation (the lane's top-tier Discussion link) and one roster (its Members link),
 * so a navigator over either would have nothing to switch between. The body spends that space on what a
 * Task's reader actually checks: its status, due date, owner and assignee; and its task lists. Each is
 * its own collapsible {@link LaneSection}, sharing the open-state map the channel tree uses, so a
 * reader's collapsed sections survive a navigation exactly as its groups do.
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
		</LaneSections>
	);
}
