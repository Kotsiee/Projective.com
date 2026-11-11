import type { MenuItem } from "@ui/types/mod.ts";
import { composeMenu, copyLink, linkOpenItem } from "@ui/navigation/core/link-actions.ts";
import { type BoardCard, type BoardColumn, ticketDeletable } from "../types/projects-types.ts";
import { asksToFund, fundingAction } from "./funding-ui.ts";
import { activeStagesFor } from "./ticket-view.ts";
import { isClaimDrop } from "./board-model.ts";
import { withTicketParam } from "./ticket-link.ts";

/**
 * board-menus — the rows a right-click opens on the project board: a ticket card's and a column's.
 * Pure: the island hands in what its own gates already decided and the commands to run, and these
 * builders decide which rows exist, in what order, and why a row is refused. A row that could not do
 * anything is absent (root CLAUDE.md §3 gate 11); a row whose refusal the reader should understand is
 * present, disabled, with the reason.
 *
 * @module
 */

// #region Ticket
/** What the board already knows about one card and the viewer's seat on it. */
export interface TicketMenuFacts {
	card: BoardCard;
	/** The board's columns, in order, and the one the card sits in now. */
	columns: readonly BoardColumn[];
	currentColumnId: string;
	isClient: boolean;
	isFreelancer: boolean;
	/** The board's own address WITHOUT `?tkv=` — the ticket link is it plus the card's slug. */
	boardHref: string;
	/** The island's `viewerCanClaim` answer. */
	canClaim: boolean;
	/** The island's `canDrag` answer — the same gate a drag reads. */
	canMove: boolean;
	/** The island's column lock for this card (`workColumnLocked`), or `null`. */
	dropRefusal: (column: BoardColumn) => string | null;
}

/** The commands the ticket rows run. */
export interface TicketMenuActions {
	open: () => void;
	claim: () => void;
	startWork: () => void;
	submitWork: (stageId: string) => void;
	fund: () => void;
	moveTo: (columnId: string) => void;
	copied: (ok: boolean) => void;
	remove: () => void;
}

const DELETE_REFUSED =
	"Claimed, funded or submitted-against tickets keep their history and can't be deleted.";

/** Why a Move to destination is refused for this viewer, or `null` when the move may be asked for. */
function moveRefusal(facts: TicketMenuFacts, to: BoardColumn): string | null {
	const lock = facts.dropRefusal(to);
	if (lock) return lock;
	const toDone = to.kind === "completed" || (to.kind === "status" && to.status === "completed");
	if (toDone && !facts.isClient) return "Only the client can move a ticket to Done.";
	if (isClaimDrop(facts.card, to) && !facts.card.personal && facts.isClient) {
		return "A freelancer starts this ticket by claiming it.";
	}
	return null;
}

/** The ticket card's right-click rows. */
export function ticketMenuModel(facts: TicketMenuFacts, run: TicketMenuActions): MenuItem[] {
	const { card } = facts;
	const href = card.slug ? withTicketParam(facts.boardHref, card.slug) : null;

	const open: MenuItem[] = href
		? [
			{
				...linkOpenItem({
					href,
					label: "Open ticket",
					key: "ticket-open",
					icon: "ticket",
					copy: false,
				}),
				url: undefined,
				command: run.open,
			},
			{
				key: "ticket-copy",
				label: "Copy ticket link",
				icon: "link",
				command: () => void copyLink(href).then(run.copied),
			},
		]
		: [{ key: "ticket-open", label: "Open ticket", icon: "ticket", command: run.open }];

	const work: MenuItem[] = [];
	if (facts.canClaim) {
		work.push({ key: "ticket-claim", label: "Claim ticket", icon: "check", command: run.claim });
	}
	const funding = card.funding;
	if (
		facts.isFreelancer && card.claimed && funding && fundingAction(funding, "provider") === "start"
	) {
		work.push({ key: "ticket-start", label: "Start work", icon: "play", command: run.startWork });
	}
	const active = activeStagesFor(card);
	const startPending = funding !== null &&
		(fundingAction(funding, "provider") ?? "").startsWith("start");
	if (facts.isFreelancer && card.claimed && active.length > 0 && !startPending) {
		const stageId = active[0].stageId;
		work.push({
			key: "ticket-submit",
			label: "Submit work",
			icon: "upload",
			command: () => run.submitWork(stageId),
		});
	}
	if (facts.isClient && !card.personal && funding && asksToFund(funding)) {
		work.push({ key: "ticket-fund", label: "Fund ticket", icon: "wallet", command: run.fund });
	}

	const targets = facts.canMove
		? facts.columns.filter((c) => c.id !== facts.currentColumnId).map((c): MenuItem => {
			const reason = moveRefusal(facts, c);
			return {
				key: `ticket-move:${c.id}`,
				label: c.title,
				disabled: reason !== null,
				disabledReason: reason ?? undefined,
				command: () => run.moveTo(c.id),
			};
		})
		: [];
	const move: MenuItem[] = targets.length > 0
		? [{ key: "ticket-move", label: "Move to", icon: "move", items: targets }]
		: [];

	const deletable = ticketDeletable(card);
	const remove: MenuItem[] = facts.isClient && !card.frozen
		? [{
			key: "ticket-delete",
			label: "Delete ticket",
			icon: "trash",
			danger: true,
			disabled: !deletable,
			disabledReason: deletable ? undefined : DELETE_REFUSED,
			command: run.remove,
		}]
		: [];

	return composeMenu(open, work, move, remove);
}

// #endregion

// #region Column
/** What the board knows about one column and the viewer's seat on the board. */
export interface ColumnMenuFacts {
	column: BoardColumn;
	/** The viewer may create a ticket here (client seat · ticket-bearing board · `canCreateTicket`). */
	canCreate: boolean;
	/** The viewer may add a stage (client seat on the project board's Stages grouping). */
	canAddStage: boolean;
	/** The stage channel this column is, as `/projects/{slug}/{stageSlug}`, or `null`. */
	stageHref: string | null;
}

/** The commands the column rows run. */
export interface ColumnMenuActions {
	createTicket: () => void;
	addStage: () => void;
}

/**
 * A column's right-click rows. Empty when the viewer can do nothing here, which leaves the
 * right-click to the browser rather than opening an empty menu.
 */
export function columnMenuModel(facts: ColumnMenuFacts, run: ColumnMenuActions): MenuItem[] {
	const create: MenuItem[] = facts.canCreate
		? [{ key: "column-new-ticket", label: "New ticket", icon: "plus", command: run.createTicket }]
		: [];
	const stage: MenuItem[] = [];
	if (facts.stageHref) {
		stage.push(linkOpenItem({
			href: facts.stageHref,
			label: "Open stage channel",
			key: "column-open-stage",
			icon: "arrow-right",
		}));
	}
	if (facts.canAddStage) {
		stage.push({
			key: "column-add-stage",
			label: "Add stage",
			icon: "square-pen",
			command: run.addStage,
		});
	}
	return composeMenu(create, stage);
}
// #endregion
