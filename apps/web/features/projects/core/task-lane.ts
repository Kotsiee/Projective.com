import {
	type BoardCard,
	type BoardPage,
	type ProjectDetail,
	type ProjectMember,
	type ProjectParty,
	TICKET_STATUS_WORD,
	type TicketStatus,
	type TicketTask,
} from "../types/projects-types.ts";
import { channelHref } from "./chat-context.ts";
import { formatDueDate } from "./ticket-model.ts";

/**
 * task-lane — the projection a Task engagement's middle-nav lane draws in place of a channel tree:
 * the one ticket that IS the task, its due date, and its task lists.
 *
 * A projection over the SAME board read the Tasks board and the ticket modal use, never a second read
 * of the ticket, so the lane cannot show a checklist, a due date or a status the modal one click away
 * would contradict. It inherits the board's provider scoping for free: a freelancer who is not seated
 * on the Task's stage is handed no ticket by the read, and the lane says so rather than showing them a
 * checklist they could not act on.
 *
 * Pure, total and DOM-free — the SSR resolver builds it for the first byte, and the lane island
 * rebuilds it from a `null` board when the owner switches an unsaved form to Task, so the two cases
 * are one code path rather than a live one beside a static one.
 *
 * @module
 */

// #region Shapes
/** One of the Task's task lists — the ticket's own checklist, or one stage's steps for it. */
export interface TaskLaneList {
	/** Stable key: `ticket`, or `stage:{stageId}` for a stage-scoped list. */
	key: string;
	label: string;
	items: TicketTask[];
	done: number;
	total: number;
}

/** The ticket a Task is delivered through, reduced to what the lane reads. */
export interface TaskLaneTicket {
	/** The `tkt-…` address the `?tkv=` deep link opens; `null` for a ticket not yet saved. */
	slug: string | null;
	title: string;
	status: TicketStatus;
	/** The plain word for {@link status} ("In progress", "In review", …). */
	statusLabel: string;
	/** The freelancer who claimed it, or `null` while unclaimed. */
	assignee: ProjectParty | null;
}

/** What the Task lane draws. */
export interface TaskLane {
	/** The Task's ticket, or `null` when none exists yet or none is visible to this viewer. */
	ticket: TaskLaneTicket | null;
	/** ISO instant the Task is due, or `null` when nothing dates it. */
	dueAt: string | null;
	/** {@link dueAt} as the lane prints it ("Aug 4"), formatted once so SSR and hydration agree. */
	dueLabel: string | null;
	/** The non-empty task lists, the ticket's own checklist first. */
	lists: TaskLaneList[];
	/** The Tasks board where the ticket is created and moved, or `null` when this viewer has none. */
	boardHref: string | null;
}

/** The list switcher's value: one list's {@link TaskLaneList.key}, or every list at once. */
export const ALL_TASK_LISTS = "all";
// #endregion

// #region Builders
/**
 * The ticket a Task is delivered through.
 *
 * A real Task holds one ticket, so the ordering below only ever decides anything for a row the database
 * could not have produced — and for that case it prefers a live ticket placed in a stage over a
 * cancelled one or a frozen report, which is the one a reader came to see.
 */
function taskTicketOf(cards: readonly BoardCard[]): BoardCard | null {
	const live = cards.filter((card) => !card.frozen && card.status !== "cancelled");
	return live.find((card) => card.stageId !== null) ?? live[0] ?? null;
}

/** A list with its own progress, or `null` when it has nothing to list. */
function listOf(key: string, label: string, items: readonly TicketTask[]): TaskLaneList | null {
	if (items.length === 0) return null;
	return {
		key,
		label,
		items: [...items],
		done: items.filter((item) => item.done).length,
		total: items.length,
	};
}

/**
 * Build the Task lane from the engagement and its board.
 *
 * The due date is the TICKET's when it has one — that is the deadline the freelancer agreed to — and
 * the stage's scheduled end otherwise, since a Task's one stage IS the Task. Neither is ever invented:
 * with no date on either, the lane says there is none.
 *
 * The Tasks board is offered only to a viewer who may open it — the client side, or a provider seated
 * on the stage — matching the channel header's own gate on the Tasks tab, so the lane never links to a
 * view the header would not show the same person.
 */
export function buildTaskLane(detail: ProjectDetail, board: BoardPage | null): TaskLane {
	const card = board ? taskTicketOf(board.cards) : null;
	const stage = board ? [...board.stages].sort((a, b) => a.order - b.order)[0] ?? null : null;
	const stageSlug = stage?.slug ??
		[...detail.channels.stages].sort((a, b) => a.order - b.order)[0]?.slug ?? null;

	const dueAt = card?.dueDate ?? stage?.endAt ?? null;
	const dueLabel = card?.dueDate
		? card.dueLabel ?? formatDueDate(card.dueDate)
		: formatDueDate(dueAt);

	const lists: TaskLaneList[] = [];
	if (card) {
		const own = listOf("ticket", "Checklist", card.tasks);
		if (own) lists.push(own);
		for (const ref of [...card.stages].sort((a, b) => a.order - b.order)) {
			const steps = listOf(`stage:${ref.stageId}`, ref.name, ref.tasks);
			if (steps) lists.push(steps);
		}
	}

	const seated = board
		? board.viewerIsClient || (stage !== null && board.viewerStageIds.includes(stage.id))
		: detail.viewerIsClient;

	return {
		ticket: card
			? {
				slug: card.slug ?? null,
				title: card.title,
				status: card.status,
				statusLabel: TICKET_STATUS_WORD[card.status],
				assignee: card.assignee,
			}
			: null,
		dueAt,
		dueLabel,
		lists,
		boardHref: seated && stageSlug ? `${channelHref(detail.slug, stageSlug)}/tasks` : null,
	};
}
// #endregion

// #region Switching + filtering
/**
 * The lists the switcher's value shows: the one it names, or every list for {@link ALL_TASK_LISTS}.
 *
 * A value naming a list that no longer exists falls back to every list rather than to none — the
 * switcher's selection is view state, and the lists can change under it (a save that empties one, a
 * re-read that drops a stage), so a stale key must never leave the section blank.
 */
export function visibleTaskLists(
	lists: readonly TaskLaneList[],
	selected: string,
): TaskLaneList[] {
	const one = lists.find((list) => list.key === selected);
	return one ? [one] : [...lists];
}

/** A list's items under the quick filter: every item, or only the ones not done yet. */
export function filterTaskItems(items: readonly TicketTask[], openOnly: boolean): TicketTask[] {
	return openOnly ? items.filter((item) => !item.done) : [...items];
}

/** One collaborator as the lane's Members section lists them. */
export interface TaskCollaborator {
	party: ProjectParty;
	/** The seat, in words — "Owner", "Freelancer", … or "Assigned" for the person holding the task. */
	role: string;
}

const ROLE_WORD: Record<ProjectMember["role"], string> = {
	owner: "Owner",
	admin: "Admin",
	freelancer: "Freelancer",
	client: "Client",
	member: "Member",
};

/** Whether two parties are the same person — by handle when both have one, else by name. */
function samePerson(a: ProjectParty, b: ProjectParty): boolean {
	if (a.handle && b.handle) return a.handle === b.handle;
	return a.name === b.name;
}

/**
 * The Task's collaborators: the engagement's roster, with the person holding the ticket marked as
 * such — and added when the roster does not already name them.
 *
 * The addition is not a guess. On the live path the participant read is frequently empty for anyone
 * but the owner (its SELECT policy is owner-or-public), while the ticket's assignee is a real person
 * the board read names; a Members section that left out the one freelancer doing the Task would be
 * wrong about the only collaborator that matters.
 */
export function taskCollaborators(
	members: readonly ProjectMember[],
	assignee: ProjectParty | null,
): TaskCollaborator[] {
	const out: TaskCollaborator[] = members.map((member) => ({
		party: member.party,
		role: assignee && samePerson(member.party, assignee) ? "Assigned" : ROLE_WORD[member.role],
	}));
	if (assignee && !members.some((member) => samePerson(member.party, assignee))) {
		out.push({ party: assignee, role: "Assigned" });
	}
	return out;
}

/** Done and total across every list — the section's one-line summary. */
export function taskLaneProgress(lists: readonly TaskLaneList[]): { done: number; total: number } {
	return lists.reduce(
		(acc, list) => ({ done: acc.done + list.done, total: acc.total + list.total }),
		{ done: 0, total: 0 },
	);
}
// #endregion
