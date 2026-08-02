import type { JSX } from "preact";
import { Avatar } from "@projective/ui/display";
import { Tooltip } from "@projective/ui/feedback";
import { Icon } from "@projective/ui/icons";
import { type BoardCard, TICKET_INTENSITY_LABEL } from "../types/projects-types.ts";
import { priorityLabel, priorityTone } from "../core/board-model.ts";
import { isOverdue } from "../core/ticket-model.ts";
import { StageStatusIcon } from "./StageStatusIcon.tsx";
import { ChecklistIcon, CommentIcon, PaperclipIcon, PriorityFlagIcon } from "./board-glyphs.tsx";

/**
 * TicketCard — the content of one Kanban ticket card (the `@projective/ui/kanban` KanbanCard supplies the
 * drag chrome + grip). Icon-first (§B.6): the priority flag, the stage activity signal, and the draft /
 * frozen states are icon-only with a portal Tooltip (never inline text beyond the short chip); the card
 * body opens the ticket modal on click / Enter. The purchasing gate surfaces as a "Draft" chip when the
 * ticket has no description (title-only) — visible for planning, not yet purchasable.
 */
export interface TicketCardProps {
	card: BoardCard;
	onOpen: (card: BoardCard) => void;
}

export function TicketCard({ card, onOpen }: TicketCardProps): JSX.Element {
	const showPriority = card.priority === "high" || card.priority === "urgent";
	const overdue = isOverdue(card.dueDate) && card.status !== "completed";
	return (
		<div
			class="tkt"
			role="button"
			tabIndex={0}
			aria-label={`Open ticket: ${card.title}`}
			data-priority={priorityTone(card.priority)}
			data-frozen={card.frozen || undefined}
			onClick={() => onOpen(card)}
			onKeyDown={(e) => {
				if (e.key === "Enter" || e.key === " " || e.key === "Spacebar") {
					e.preventDefault();
					onOpen(card);
				}
			}}
		>
			<div class="tkt__head">
				{showPriority
					? (
						<Tooltip content={`${priorityLabel(card.priority)} priority`} placement="top">
							<span
								class="tkt__prio"
								data-tone={priorityTone(card.priority)}
								role="img"
								aria-label={`${priorityLabel(card.priority)} priority`}
								tabIndex={0}
							>
								<PriorityFlagIcon size={13} />
							</span>
						</Tooltip>
					)
					: null}
				<h4 class="tkt__title">{card.title}</h4>
				{card.activity ? <StageStatusIcon activity={card.activity} /> : null}
			</div>

			<div class="tkt__foot">
				<div class="tkt__meta">
					{card.dueLabel
						? (
							<Tooltip
								content={overdue ? `Overdue — was due ${card.dueLabel}` : `Due ${card.dueLabel}`}
							>
								<span
									class="tkt__m"
									data-overdue={overdue || undefined}
									tabIndex={0}
									aria-label={overdue
										? `Overdue, was due ${card.dueLabel}`
										: `Due ${card.dueLabel}`}
								>
									<Icon name="calendar" size="2xs" />
									{card.dueLabel}
								</span>
							</Tooltip>
						)
						: null}
					{card.intensity !== "standard"
						? (
							<Tooltip
								content={`${
									TICKET_INTENSITY_LABEL[card.intensity]
								} intensity — ${card.workload} units of capacity`}
							>
								<span
									class="tkt__m"
									data-level={card.intensity}
									tabIndex={0}
									aria-label={`${TICKET_INTENSITY_LABEL[card.intensity]} workload intensity`}
								>
									<Icon name="analytics" size="2xs" />
									{TICKET_INTENSITY_LABEL[card.intensity]}
								</span>
							</Tooltip>
						)
						: null}
					{card.checklistTotal > 0
						? (
							<span
								class="tkt__m"
								aria-label={`${card.checklistDone} of ${card.checklistTotal} tasks done`}
							>
								<ChecklistIcon size={13} />
								{card.checklistDone}/{card.checklistTotal}
							</span>
						)
						: null}
					{card.commentCount > 0
						? (
							<span class="tkt__m" aria-label={`${card.commentCount} comments`}>
								<CommentIcon size={13} />
								{card.commentCount}
							</span>
						)
						: null}
					{card.attachmentCount > 0
						? (
							<span class="tkt__m" aria-label={`${card.attachmentCount} attachments`}>
								<PaperclipIcon size={13} />
								{card.attachmentCount}
							</span>
						)
						: null}
					{!card.hasDescription
						? (
							<Tooltip content="Draft — add a description before it can be purchased or claimed">
								<span
									class="tkt__flag tkt__flag--draft"
									tabIndex={0}
									aria-label="Draft ticket — needs a description"
								>
									Draft
								</span>
							</Tooltip>
						)
						: null}
					{card.frozen
						? (
							<Tooltip content="Frozen — a workload report paused this ticket for 48 hours">
								<span class="tkt__flag tkt__flag--frozen" tabIndex={0} aria-label="Frozen ticket">
									Frozen
								</span>
							</Tooltip>
						)
						: null}
				</div>
				<div class="tkt__end">
					{card.budgetLabel ? <span class="tkt__budget">{card.budgetLabel}</span> : null}
					{card.assignee
						? (
							<Avatar
								image={card.assignee.avatar ?? undefined}
								label={card.assignee.name}
								size={22}
								alt={`Assigned to ${card.assignee.name}`}
							/>
						)
						: <span class="tkt__unassigned" aria-hidden="true" />}
				</div>
			</div>
		</div>
	);
}
