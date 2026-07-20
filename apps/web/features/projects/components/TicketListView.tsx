import type { JSX } from "preact";
import type { BoardCard } from "../types/projects-types.ts";
import { priorityLabel, priorityTone, statusLabel, statusTone } from "../core/board-model.ts";

/**
 * TicketListView — the flat List presentation of the board (the footer's Kanban⁄List switch). A dense,
 * scannable table of the filtered tickets: title (+ the Draft gate), the column/lane, assignee,
 * priority, budget, and last update. A row opens the ticket modal. Token-only, §B.4 (rows separated by a
 * single hairline, no boxes).
 */
export interface TicketListViewProps {
	cards: BoardCard[];
	/** Resolve a card's current lane/column title for the active view. */
	laneOf: (card: BoardCard) => string;
	onOpen: (card: BoardCard) => void;
}

export function TicketListView({ cards, laneOf, onOpen }: TicketListViewProps): JSX.Element {
	if (cards.length === 0) {
		return (
			<div class="brd-empty" role="status">
				<p class="brd-empty__title">No tickets here</p>
				<p class="brd-empty__note">No tickets match the current search and filters.</p>
			</div>
		);
	}
	return (
		<div class="brd-list" role="table" aria-label="Tickets">
			<div class="brd-list__row brd-list__row--head" role="row">
				<span class="brd-list__cell" role="columnheader">Ticket</span>
				<span class="brd-list__cell" role="columnheader">Lane</span>
				<span class="brd-list__cell" role="columnheader">Status</span>
				<span class="brd-list__cell" role="columnheader">Assignee</span>
				<span class="brd-list__cell" role="columnheader">Priority</span>
				<span class="brd-list__cell brd-list__cell--num" role="columnheader">Budget</span>
				<span class="brd-list__cell" role="columnheader">Updated</span>
			</div>
			{cards.map((c) => (
				<button
					key={c.id}
					type="button"
					class="brd-list__row"
					role="row"
					onClick={() => onOpen(c)}
				>
					<span class="brd-list__cell brd-list__title" role="cell">
						<span class="brd-list__name">{c.title}</span>
						{!c.hasDescription
							? <span class="brd-list__draft" aria-label="Draft — needs a description">Draft</span>
							: null}
					</span>
					<span class="brd-list__cell brd-list__lane" role="cell">{laneOf(c)}</span>
					<span class="brd-list__cell" role="cell">
						<span class="brd-list__status" data-tone={statusTone(c.status)}>
							{statusLabel(c.status)}
						</span>
					</span>
					<span class="brd-list__cell" role="cell">{c.assignee?.name ?? "—"}</span>
					<span class="brd-list__cell" role="cell">
						<span class="brd-list__prio" data-tone={priorityTone(c.priority)}>
							{priorityLabel(c.priority)}
						</span>
					</span>
					<span class="brd-list__cell brd-list__cell--num" role="cell">{c.budgetLabel ?? "—"}</span>
					<span class="brd-list__cell brd-list__date" role="cell">{c.dateLabel}</span>
				</button>
			))}
		</div>
	);
}
