import type { JSX } from "preact";
import { ticketStack } from "../../core/ticket-view.ts";
import { FileFrame } from "../FileFrame.tsx";

/** Props for {@link TicketFileFrame}. */
export interface TicketFileFrameProps {
	/** The `file` frame's identity on the ticket chain. */
	uid: number;
	/** The acting viewer's id; empty when signed out. */
	viewerId: string;
	/** The engagement's route slug. */
	projectId: string;
}

/** Pop the file frame, restoring the ticket or review beneath it with its cached state. */
function closeFileFrame(): void {
	if (!ticketStack.back()) ticketStack.close();
}

/**
 * TicketFileFrame — a file opened from inside the ticket chain (an attachment, a submission file, a
 * review's file). It REPLACES the frame beneath on `ticketStack`; dismissing it restores that frame
 * at the tab, scroll and tile it was left at. Rendered by whichever host renders the ticket chain.
 */
export function TicketFileFrame(props: TicketFileFrameProps): JSX.Element | null {
	return (
		<FileFrame
			stack={ticketStack}
			uid={props.uid}
			viewerId={props.viewerId}
			projectId={props.projectId}
			context={{ kind: "ticket" }}
			onClose={closeFileFrame}
		/>
	);
}
