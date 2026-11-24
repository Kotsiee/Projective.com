import type { JSX } from "preact";
import { untracked, useSignal, useSignalEffect } from "@preact/signals";
import { useEffect } from "preact/hooks";
import { Button } from "@projective/ui/fields";
import type { TicketDisputeState } from "@projective/types/finance";
import { readDevSeam, subscribeDevSeam } from "@web/utils/dev-seam.ts";
import { DisputeService } from "../../core/DisputeService.ts";
import type { TicketFrameInput } from "../../core/ticket-view.ts";

/**
 * TicketDisputeLine — the ticket view's dispute entry (PROJECTS EX2; DESIGN_SYSTEM §C.1): one line of
 * meta text and one text control, shown only where `finance.ticket_dispute_state` says there is a case
 * to view or one may be raised now (the work in review on its stage, or approved work whose payment is
 * still clearing). The control opens the case, or the form that raises one, as the ticket's next modal
 * frame. The Dev Context Switcher's Ticket dispute axis previews it without the server's say.
 */
export interface TicketDisputeLineProps {
	ticketId: string;
	ticketTitle: string;
	/** The ticket's current stage, for the dev preview's Raise. */
	stageId: string | null;
	onOpen: (dispute: NonNullable<TicketFrameInput["dispute"]>) => void;
}

export function TicketDisputeLine(props: TicketDisputeLineProps): JSX.Element | null {
	const state = useSignal<TicketDisputeState | null>(null);
	const forced = useSignal(readDevSeam()?.ticketDispute);
	useEffect(() => subscribeDevSeam((seam) => (forced.value = seam?.ticketDispute)), []);
	useSignalEffect(() => {
		untracked(() => {
			void DisputeService.ticketState(props.ticketId).then((res) => {
				state.value = res.ok && res.data ? res.data.state : null;
			});
		});
	});

	const s: TicketDisputeState | null = forced.value === "none"
		? null
		: forced.value === "raisable"
		? {
			side: "payer",
			disputeId: null,
			status: null,
			stageId: props.stageId,
			canRaise: true,
			window: "held",
		}
		: state.value;
	if (!s || (!s.disputeId && !(s.canRaise && s.stageId))) return null;
	return (
		<p class="tkv-dispute">
			<span class="tkv-dispute__text">
				{s.disputeId
					? "A dispute is open on this ticket's payment."
					: s.window === "pending"
					? "Approved work can be disputed while its payment clears."
					: "The work in review can be disputed."}
			</span>
			<Button
				label={s.disputeId ? "View dispute" : "Raise a dispute"}
				severity="secondary"
				variant="text"
				size="sm"
				onClick={() =>
					props.onOpen({
						disputeId: s.disputeId,
						stageId: s.stageId,
						window: s.window,
						ticketTitle: props.ticketTitle,
					})}
			/>
		</p>
	);
}
