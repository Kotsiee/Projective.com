import type { JSX } from "preact";
import { Avatar } from "@projective/ui/display";
import { Tooltip } from "@projective/ui/feedback";
import { Icon } from "@projective/ui/icons";
import {
	type BoardCard,
	TICKET_INTENSITY_LABEL,
	TICKET_PAYMENT_SCOPE_LABEL,
	ticketPaidHere,
} from "../types/projects-types.ts";
import { priorityLabel, priorityTone } from "../core/board-model.ts";
import { isOverdue } from "../core/ticket-model.ts";
import { StageStatusIcon } from "./StageStatusIcon.tsx";
import { ChecklistIcon, CommentIcon, PaperclipIcon, PriorityFlagIcon } from "./board-glyphs.tsx";

/**
 * TicketCard — the CONTENT of one Kanban ticket card. The `@projective/ui/kanban` KanbanCard around it
 * is the interactive element: it is the drag handle, the tab stop, and what opens the ticket on click
 * or Enter — so nothing here carries a `role`, a `tabIndex` on its root, or a click handler, because a
 * second focusable root inside the card would make every ticket two tab stops that both open it.
 *
 * Icon-first (§B.6): the priority flag, the stage activity signal, the client's drag lock and the
 * draft / frozen states are icon-only or a short chip with a portal Tooltip. Two lifecycle facts earn
 * a container (§B.11.3): **Draft** — the purchasing gate, a title-only ticket that cannot be bought
 * or claimed yet — and **Unpaid** — a described ticket sitting in a stage nobody has paid for, which
 * no freelancer can see. A ticket that IS paid where it sits shows an icon-only check beside its
 * price rather than a second pill, so a card never carries two adjacent fills (§3 gate 7). The two
 * badges live at opposite ends of the foot for the same reason.
 */
export interface TicketCardProps {
	card: BoardCard;
	/**
	 * Whether the client's drag is locked because a freelancer is actively working this ticket. Drawn
	 * as a lock glyph with the reason in its tooltip — the fact is useful to the client, so it is
	 * rendered-and-explained rather than silently made undraggable (Decision #60's two gates).
	 */
	lockedForClient?: boolean;
}

export function TicketCard({ card, lockedForClient = false }: TicketCardProps): JSX.Element {
	const showPriority = card.priority === "high" || card.priority === "urgent";
	const overdue = isOverdue(card.dueDate) && card.status !== "completed";
	const paidHere = ticketPaidHere(card);
	// Funding is only a fact about a ticket that CAN be bought — a draft has nothing to be paid for,
	// and its Draft chip already says so.
	const showFunding = card.hasDescription;
	return (
		<div
			class="tkt"
			data-priority={priorityTone(card.priority)}
			data-frozen={card.frozen || undefined}
			data-unpaid={showFunding && !paidHere ? "" : undefined}
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
				{lockedForClient
					? (
						<Tooltip content="A freelancer is working this ticket. It can be moved again once the work is handed back for review, or the ticket is reassigned.">
							<span
								class="tkt__lock"
								role="img"
								aria-label="Locked while a freelancer works this ticket"
								tabIndex={0}
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
					{showFunding
						? paidHere
							? (
								<Tooltip
									content={card.paymentScope === "full"
										? "Paid in full — claimable in every stage"
										: "Paid for this stage — claimable here"}
								>
									<span
										class="tkt__pay tkt__pay--paid"
										role="img"
										aria-label={`${TICKET_PAYMENT_SCOPE_LABEL[card.paymentScope]} — paid for this stage`}
										tabIndex={0}
									>
										<Icon name="check" size="2xs" />
									</span>
								</Tooltip>
							)
							: (
								<Tooltip
									content={card.paymentScope === "per_stage"
										? "Paid per stage, but not for this one — hidden from freelancers until this stage is funded"
										: "Not paid yet — hidden from freelancers until it is funded"}
								>
									<span
										class="tkt__pay tkt__pay--unpaid"
										tabIndex={0}
										aria-label={card.paymentScope === "per_stage"
											? "Unpaid for this stage"
											: "Unpaid ticket"}
									>
										Unpaid
									</span>
								</Tooltip>
							)
						: null}
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
