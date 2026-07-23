import type { JSX } from "preact";
import type { TaskChecklist } from "../core/submission-tasks.ts";
import { TaskChecklistView } from "./TaskChecklistView.tsx";
import { CloseIcon } from "./file-glyphs.tsx";
import { TasksPanelIcon } from "./submission-glyphs.tsx";

/**
 * TasksPanel — the right-side Tasks drawer for the Submissions workspace (root task §6). Toggled from the
 * middle-nav footer's Tasks button, it is shown ONLY when the client has defined stage/ticket tasks for
 * the current view (the footer gates its own toggle on the same availability). It docks as a sticky right
 * column of the workspace grid (a single hairline separates it — §B.4, never a box) and holds the
 * interactive stage-level + ticket-level {@link TaskChecklistView}, whose checked state is owned by the
 * explorer island (so it agrees with the Pre-Submit modal's checklist).
 */
export interface TasksPanelProps {
	checklist: TaskChecklist;
	onToggle: (id: string) => void;
	onClose: () => void;
}

export function TasksPanel({ checklist, onToggle, onClose }: TasksPanelProps): JSX.Element {
	return (
		<aside class="subm-tasks" aria-label="Stage and ticket tasks">
			<header class="subm-tasks__head">
				<span class="subm-tasks__title">
					<span class="subm-tasks__titleicon" aria-hidden="true">
						<TasksPanelIcon size={16} />
					</span>
					Tasks
				</span>
				<button
					type="button"
					class="subm-tasks__close"
					aria-label="Hide tasks panel"
					onClick={onClose}
				>
					<CloseIcon size={16} />
				</button>
			</header>
			<div class="subm-tasks__body">
				<TaskChecklistView checklist={checklist} onToggle={onToggle} />
			</div>
		</aside>
	);
}
