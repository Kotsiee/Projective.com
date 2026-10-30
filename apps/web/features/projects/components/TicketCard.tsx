import type { JSX } from "preact";
import { Tooltip } from "@projective/ui/feedback";
import { Icon } from "@projective/ui/icons";
import { type BoardCard, TICKET_INTENSITY_LABEL } from "../types/projects-types.ts";
import { asksToFund, type FundingSide } from "../core/funding-ui.ts";
import { FundingStatus } from "./FundingStatus.tsx";
import { priorityLabel, priorityTone } from "../core/board-model.ts";
import { isOverdue } from "../core/ticket-model.ts";
import { StageStatusIcon } from "./StageStatusIcon.tsx";
import { ChecklistIcon, CommentIcon, PaperclipIcon, PriorityFlagIcon } from "./board-glyphs.tsx";
import { UserAvatar } from "@web/components/UserAvatar.tsx";

/**
 * TicketCard — the CONTENT of one Kanban ticket card. The `@projective/ui/kanban` KanbanCard around it
 * is the interactive element: it is the drag handle, the tab stop, and what opens the ticket on click
 * or Enter — so nothing here carries a `role`, a `tabIndex` on its root, or a click handler, because a
 * second focusable root inside the card would make every ticket two tab stops that both open it.
 * Nor do its tooltip triggers take focus: each carries its tooltip's sentence as its `aria-label`, and
 * the KanbanCard root names this body as its description, so keyboard and screen-reader users get the
 * same facts from the card's one tab stop.
 *
 * Icon-first (§B.6): the priority flag, the stage activity signal, the client's drag lock and the
 * frozen state are icon-only or a short chip with a portal Tooltip. The ticket's funding state is the
 * compact `FundingStatus` — a lifecycle status, so it earns a container (§B.11.3) — with its sentence
 * in the tooltip; a funded ticket shows an icon-only check beside its price rather than a second pill,
 * so a card never carries two adjacent fills (§3 gate 7). Frozen and funding sit at opposite ends of
 * the foot for the same reason.
 */
export interface TicketCardProps {
	card: BoardCard;
	/**
	 * Whether the client's drag is locked because a freelancer is actively working this ticket. Drawn
	 * as a lock glyph with the reason in its tooltip — the fact is useful to the client, so it is
	 * rendered-and-explained rather than silently made undraggable (Decision #60's two gates).
	 */
	lockedForClient?: boolean;
	/** Whose sentence the funding tooltip reads — the client's, or the payee's. */
	side?: FundingSide;
}

export function TicketCard(
	{ card, lockedForClient = false, side = "client" }: TicketCardProps,
): JSX.Element {
	const showPriority = card.priority === "high" || card.priority === "urgent";
	const overdue = isOverdue(card.dueDate) && card.status !== "completed";
	return (
		<div
			class="tkt"
			data-priority={priorityTone(card.priority)}
			data-frozen={card.frozen || undefined}
			data-unpaid={card.funding && asksToFund(card.funding) ? "" : undefined}
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
							>
								<PriorityFlagIcon size={13} />
							</span>
						</Tooltip>
					)
					: null}
				<h4 class="tkt__title">{card.title}</h4>
				{card.activity ? <StageStatusIcon activity={card.activity} /> : null}
				{lockedForClient
					? (
						<Tooltip content="A freelancer is working this ticket. It can be moved again once the work is handed back for review, or the ticket is reassigned.">
							<span
								class="tkt__lock"
								role="img"
								aria-label="Locked: a freelancer is working this ticket. It can be moved again once the work is handed back for review, or the ticket is reassigned."
							>
								<Icon name="lock" size="2xs" />
							</span>
						</Tooltip>
					)
					: null}
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
									aria-label={`${
										TICKET_INTENSITY_LABEL[card.intensity]
									} workload intensity, ${card.workload} units of capacity`}
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
					{card.frozen
						? (
							<Tooltip content="Frozen — a workload report paused this ticket for 48 hours">
								<span
									class="tkt__flag tkt__flag--frozen"
									aria-label="Frozen: a workload report paused this ticket for 48 hours"
								>
									Frozen
								</span>
							</Tooltip>
						)
						: null}
				</div>
				<div class="tkt__end">
					<FundingStatus
						compact
						funding={card.funding}
						side={side}
						freelancer={card.assignee?.name ?? null}
					/>
					{card.budgetLabel ? <span class="tkt__budget">{card.budgetLabel}</span> : null}
					{card.assignee
						? (
							<UserAvatar
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
