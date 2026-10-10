import type { JSX } from "preact";
import AssetPicker from "@web/features/files/islands/AssetPicker.island.tsx";
import { handOffPicks } from "@web/features/files/core/picker-frame.ts";
import type { AssetItem } from "@web/features/files/types/file-types.ts";
import { TICKET_PICKER_ID, ticketStack } from "../../core/ticket-view.ts";

/** Props for {@link TicketPickerFrame}. */
export interface TicketPickerFrameProps {
	/** The `picker` frame's identity on the ticket chain. */
	uid: number;
}

function handOffToTicket(assets: AssetItem[]): void {
	const ticket = ticketStack.beneath.peek();
	if (ticket?.kind === "ticket") handOffPicks(ticketStack, ticket.uid, assets);
}

/**
 * TicketPickerFrame — the Asset Picker opened from a ticket's Attachments tab. It REPLACES the ticket
 * on `ticketStack`; the picks are handed off to the ticket frame's cache before the pop, and the
 * restored ticket stages them. Rendered by whichever host renders the ticket chain.
 */
export function TicketPickerFrame(props: TicketPickerFrameProps): JSX.Element {
	return (
		<AssetPicker
			key={props.uid}
			requesterId={TICKET_PICKER_ID}
			frame={{ stack: ticketStack, uid: props.uid }}
			mode="multi"
			title="Attach from your files"
			onPick={handOffToTicket}
		/>
	);
}
