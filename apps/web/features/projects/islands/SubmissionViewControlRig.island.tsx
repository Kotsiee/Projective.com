import type { JSX } from "preact";
import { useEffect } from "preact/hooks";
import "../styles/submission-rig.css";
import { Tooltip } from "@projective/ui/feedback";
import { ViewZoomRig } from "@web/features/shell/components/ViewZoomRig.tsx";
import { filesZoom } from "../core/view-state.ts";
import { tasksAvailable, tasksPanelOpen, toggleTasksPanel } from "../core/submission-workspace.ts";
import { GridIcon, ListIcon } from "../components/file-glyphs.tsx";
import { TasksPanelIcon } from "../components/submission-glyphs.tsx";

/**
 * SubmissionViewControlRig — the Submissions explorer's footer band, mounted in the middle-nav FOOTER
 * slot via {@link submissionsFooterFor}. It is the shared {@link ViewZoomRig} on the LEFT (the mode
 * glyph · a segmented zoom track with a centred transition marker · ± buttons — writing the same
 * `filesZoom` store the File Explorer uses, so the two surfaces share one density) AND — pinned to the
 * far RIGHT (root task §6) — the
 * **Tasks panel toggle**, shown only when the client has defined stage/ticket tasks for the current view
 * ({@link tasksAvailable}, published by the explorer body). Toggling it flips the shared
 * {@link tasksPanelOpen} the body watches to mount/unmount the Tasks drawer. Dumb island: no data access;
 * the primary workflow actions (Create / Review / Submit …) live in the crumb bar beside the body state.
 */
export default function SubmissionViewControlRig(): JSX.Element {
	useEffect(() => filesZoom.restoreZoom(), []);

	return (
		<div class="subm-rig">
			<ViewZoomRig
				store={filesZoom}
				label="Submission view zoom"
				class="subm-rig__zoom"
				listIcon={<ListIcon size={16} />}
				gridIcon={<GridIcon size={16} />}
			/>

			<span class="subm-rig__spacer" />

			{tasksAvailable.value
				? (
					<Tooltip content={tasksPanelOpen.value ? "Hide tasks" : "Show tasks"} placement="top">
						<button
							type="button"
							class="subm-rig__tasks"
							data-on={tasksPanelOpen.value ? "true" : undefined}
							aria-pressed={tasksPanelOpen.value}
							aria-label={tasksPanelOpen.value ? "Hide tasks panel" : "Show tasks panel"}
							onClick={toggleTasksPanel}
						>
							<span class="subm-rig__tasksicon" aria-hidden="true">
								<TasksPanelIcon size={17} />
							</span>
							<span class="subm-rig__taskslabel">Tasks</span>
						</button>
					</Tooltip>
				)
				: null}
		</div>
	);
}
