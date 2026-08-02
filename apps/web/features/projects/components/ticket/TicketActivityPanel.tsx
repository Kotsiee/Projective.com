import type { JSX } from "preact";
import { Icon } from "@projective/ui/icons";
import type { BoardCard, TicketHistoryEntry } from "../../types/projects-types.ts";
import { TicketHistoryRow } from "./TicketHistoryRow.tsx";

/** How much of the log the panel carries before it defers to the archive. */
const RECENT = 8;

/**
 * TicketActivityPanel — the Details tab's side panel: what has happened to this ticket lately.
 *
 * The Details tab answers "what is being asked for". That question is almost always being asked
 * *because* something moved — a revision came back, the price changed, somebody claimed it — so the
 * panel puts the recent movement beside the brief rather than one tab away. It is a GLANCE, not the
 * archive: the newest handful of events, headlines only, with the full log one click away.
 *
 * On a ticket nobody has touched, the panel says so plainly instead of rendering an empty column —
 * an unexplained blank beside a brief reads as something failing to load.
 */
export interface TicketActivityPanelProps {
	card: BoardCard;
	/** Follow an entry to what it refers to (a submission → the Submissions tab, at it). */
	onFollow: (entry: TicketHistoryEntry) => void;
	/** Open the full archive. */
	onOpenHistory: () => void;
	/** Whether the full archive exists on this surface — a ticket being created has no History tab. */
	hasArchive: boolean;
}

export function TicketActivityPanel(props: TicketActivityPanelProps): JSX.Element {
	const { card } = props;
	const recent = card.history.slice(0, RECENT);
	const rest = card.history.length - recent.length;

	return (
		<aside class="tkv-rail" aria-label="Recent activity">
			<header class="tkv-rail__head">
				<h3 class="tkv-rail__title">Recent activity</h3>
				{card.unreadCount > 0
					? (
						<span class="tkv-rail__count" data-unread="true">
							{card.unreadCount} new
						</span>
					)
					: null}
			</header>

			{recent.length === 0
				? (
					<p class="tkv-empty tkv-empty--inline">
						{props.hasArchive
							? "Nothing has happened to this ticket yet."
							: "Activity starts once this ticket is created."}
					</p>
				)
				: (
					<>
						<ol class="tkv-log tkv-log--compact" aria-label="Recent ticket activity">
							{recent.map((h) => (
								<TicketHistoryRow key={h.id} entry={h} onFollow={props.onFollow} compact />
							))}
						</ol>
						{rest > 0 && props.hasArchive
							? (
								<button type="button" class="tkv-rail__more" onClick={props.onOpenHistory}>
									<Icon name="history" size="2xs" />
									{rest} earlier {rest === 1 ? "event" : "events"}
								</button>
							)
							: null}
					</>
				)}
		</aside>
	);
}
