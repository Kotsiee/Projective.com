import type { JSX } from "preact";
import { Icon } from "@projective/ui/icons";
import type { CalendarEvent, EventHistoryEntry } from "@projective/types/scheduling";
import { EventHistoryRow } from "../EventHistoryRow.tsx";

/**
 * EventHistoryTab — the whole archive, newest first.
 *
 * The same {@link EventHistoryRow} the attendee panel's glance renders, at full length. Rows are told
 * apart by one hairline and nothing else: no frames, no zebra (§B.4).
 *
 * The log is append-only — a correction is a new line, never an edit to an old one — so what a reader
 * sees here is what happened, in the order it happened.
 */
export interface EventHistoryTabProps {
	event: CalendarEvent;
	onFollow?: (entry: EventHistoryEntry) => void;
}

export function EventHistoryTab(props: EventHistoryTabProps): JSX.Element {
	const entries = [...(props.event.history ?? [])].reverse();

	if (entries.length === 0) {
		return (
			<div class="evm-empty" role="status">
				<Icon name="history" size="lg" class="evm-empty__mark" />
				<p class="evm-empty__title">Nothing has happened yet</p>
				<p class="evm-empty__note">
					Edits, proposed times, votes, responses and attachments all land here as they happen.
				</p>
			</div>
		);
	}

	return (
		<ol class="evm-log" aria-label="Event history">
			{entries.map((entry) => (
				<EventHistoryRow key={entry.id} entry={entry} onFollow={props.onFollow} />
			))}
		</ol>
	);
}
