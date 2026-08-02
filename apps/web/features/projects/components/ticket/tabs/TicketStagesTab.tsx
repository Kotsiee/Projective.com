import type { JSX } from "preact";
import type { Signal } from "@preact/signals";
import type { BoardStageRef } from "../../../types/projects-types.ts";
import type { TicketStageView } from "../../../core/ticket-view.ts";
import { StagePipeline } from "../StagePipeline.tsx";

/**
 * TicketStagesTab — the ticket's pipeline: which stages it runs through, in what order, and which of
 * them run at the same time.
 *
 * It is the SAME surface whether the ticket is being created or read. That is the point of the
 * merge: a client who composed a pipeline and a freelancer who came to understand one are looking at
 * the same diagram, and only the grips, the joins and the "stages not in this ticket" list appear or
 * disappear with the right to change it.
 *
 * Selecting a stage does not expand it here. It opens in the MODAL's right-hand panel — one place a
 * stage is read in full, one place it is configured, and the diagram stays legible while you work on
 * a row of it.
 */
export interface TicketStagesTabProps {
	stageViews: TicketStageView[];
	/** Stages of the engagement this ticket does not currently include. */
	available: BoardStageRef[];
	/** The stage open in the modal's side panel. Shared, because the panel lives outside this tab. */
	selected: Signal<string | null>;
	/** Whether the viewer may change the ticket's composition. */
	editable: boolean;
	onToggle: (stageId: string) => void;
	onMove: (from: number, to: number) => void;
	onParallel: (stageId: string, parallel: boolean) => void;
}

export function TicketStagesTab(props: TicketStagesTabProps): JSX.Element {
	return (
		<StagePipeline
			resolved={props.stageViews}
			available={props.available}
			selectedStageId={props.selected.value}
			editable={props.editable}
			onSelect={(id) => (props.selected.value = id)}
			onToggle={props.onToggle}
			onMove={props.onMove}
			onParallel={props.onParallel}
		/>
	);
}
