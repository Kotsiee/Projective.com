import type { JSX } from "preact";
import type { BoardCard, TicketHistoryEntry } from "../../../types/projects-types.ts";
import { TicketHistoryRow } from "../TicketHistoryRow.tsx";

/**
 * TicketHistoryTab — everything that has happened to this ticket, newest first.
 *
 * Newest first because the log answers "what just happened" far more often than "how did we get
 * here", and a reader who wants the origin can always reach the bottom.
 *
 * The rows are the SAME {@link TicketHistoryRow} the Details panel's recent-activity feed renders, so
 * the full archive and the glance at it can never disagree — including the actor's face, which leads
 * every entry.
 */
export interface TicketHistoryTabProps {
	card: BoardCard;
	/** Follow an entry to what it refers to (currently: a submission → the Submissions tab, at it). */
	onFollow: (entry: TicketHistoryEntry) => void;
}

export function TicketHistoryTab(props: TicketHistoryTabProps): JSX.Element {
	const { card } = props;

	if (card.history.length === 0) {
		return <p class="tkv-empty">Nothing has happened to this ticket yet.</p>;
	}

	return (
		<ol class="tkv-log" aria-label="Ticket history">
			{card.history.map((h) => <TicketHistoryRow key={h.id} entry={h} onFollow={props.onFollow} />)}
		</ol>
	);
}
