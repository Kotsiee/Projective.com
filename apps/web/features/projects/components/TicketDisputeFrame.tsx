import type { JSX } from "preact";
import { untracked, useSignal, useSignalEffect } from "@preact/signals";
import type { TicketFrameInput } from "../core/ticket-view.ts";
import { DisputeCaseDialog } from "./DisputeCaseDialog.tsx";

/**
 * TicketDisputeFrame — the ticket chain's `dispute` frame (PROJECTS EX2): the ticket's case, or the form
 * that raises one, as the one modal on screen. It owns the dialog's visibility, and closing it goes back
 * to the ticket it replaced.
 */
export interface TicketDisputeFrameProps {
	ticketId: string;
	dispute: NonNullable<TicketFrameInput["dispute"]>;
	/** The dialog closed: pop the frame. */
	onClose: () => void;
	/** The case moved: the host re-reads the ticket. */
	onChanged: () => void;
}

export function TicketDisputeFrame(props: TicketDisputeFrameProps): JSX.Element {
	const open = useSignal(true);
	useSignalEffect(() => {
		if (!open.value) untracked(() => props.onClose());
	});
	const { dispute } = props;
	return (
		<DisputeCaseDialog
			open={open}
			disputeId={dispute.disputeId}
			raise={!dispute.disputeId && dispute.stageId
				? {
					ticketId: props.ticketId,
					stageId: dispute.stageId,
					ticketTitle: dispute.ticketTitle,
					window: dispute.window,
				}
				: null}
			onChanged={() => props.onChanged()}
		/>
	);
}
