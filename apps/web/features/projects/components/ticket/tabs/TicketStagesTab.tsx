import type { JSX } from "preact";
import type { BoardStageRef, TicketIntensity } from "../../../types/projects-types.ts";
import type { TicketStageView } from "../../../core/ticket-view.ts";
import type { PipelineDrop } from "../../../core/stage-pipeline.ts";
import type { PipelineLocks } from "../../../core/stage-menu.ts";
import { StagePipeline } from "../StagePipeline.tsx";

// The pipeline diagram, its inspector and the task list are `.tkc-*` — see the note in `TicketView`.
import "../../../styles/ticket-pipeline.css";

/**
 * TicketStagesTab — the ticket's pipeline: which stages it runs through, in what order, and which of
 * them run at the same time.
 *
 * It is the SAME surface on every posture: the Stages tab of a saved ticket, the stage pane beside a
 * ticket being created, and the Stages tab of either where the modal is too narrow for a pane. A
 * client who composed a pipeline and a freelancer who came to understand one are looking at the same
 * cards; only the drag, the menus and the available zone appear or disappear with the right to change
 * it.
 *
 * Selecting a stage does not expand it here. It opens in the modal's inspector — one place a stage is
 * read in full, one place it is configured — whether or not the ticket runs through it yet.
 */
export interface TicketStagesTabProps {
	stageViews: TicketStageView[];
	/** Stages of the engagement this ticket does not currently include. */
	available: BoardStageRef[];
	/** The stage open in the modal's inspector, or `null`. */
	selectedStageId: string | null;
	/** Whether the viewer may change the ticket's composition. */
	editable: boolean;
	/** The engagement's currency (`BoardCard.currency`). */
	currency: string;
	/** The ticket's intensity — what an added stage starts at. */
	intensity: TicketIntensity;
	locks: PipelineLocks;
	title?: string;
	onSelect: (stageId: string) => void;
	onPlace: (stageId: string, drop: PipelineDrop) => void;
	onSwap: (stageId: string, direction: -1 | 1) => void;
	/** Bring `peerId` into `stageId`'s step, running in parallel with it. */
	onGroup: (stageId: string, peerId: string) => void;
	onSequential: (stageId: string) => void;
}

export function TicketStagesTab(props: TicketStagesTabProps): JSX.Element {
	return (
		<StagePipeline
			resolved={props.stageViews}
			available={props.available}
			selectedStageId={props.selectedStageId}
			editable={props.editable}
			currency={props.currency}
			intensity={props.intensity}
			locks={props.locks}
			title={props.title}
			onSelect={props.onSelect}
			onPlace={props.onPlace}
			onSwap={props.onSwap}
			onGroup={props.onGroup}
			onSequential={props.onSequential}
		/>
	);
}
