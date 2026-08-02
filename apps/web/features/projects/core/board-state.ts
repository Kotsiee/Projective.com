import { signal } from "@preact/signals";
import type { BoardView } from "../types/projects-types.ts";
import { LocalKeys, readStored, writeStored } from "@web/utils/storage-keys.ts";

/**
 * Board view-state — the cross-island bridge between the middle-nav footer band (the
 * `BoardViewControlRig` island: view switchers + Create Ticket / Create Stage / Checkout) and the board
 * body (the `ProjectBoard` island, which owns the Kanban/List surface + the modals). They are separate
 * hydration boundaries, so — exactly like the File Explorer's footer↔body `zoom` and the Submissions
 * footer↔modal `reviewOpen` — they coordinate through these module-level signals: the footer publishes
 * intents (open a modal, switch a view) and reads the body's published capabilities; the body reacts.
 * Reset on unmount so a later navigation starts clean.
 */

// #region View toggles (persisted)
/** Kanban board vs a flat List view. */
export type BoardViewMode = "kanban" | "list";

/** The active board surface. */
export const boardViewMode = signal<BoardViewMode>("kanban");
/** The project board's column grouping — the Stages pipeline vs the ticket-Status lanes. */
export const boardGrouping = signal<BoardView>("stages");

let restored = false;
/** Restore the persisted view + grouping once (client-only, on first island mount) — no hydration flash. */
export function restoreBoardView(): void {
	if (restored) return;
	restored = true;
	const vm = readStored("local", LocalKeys.BOARD_VIEW);
	if (vm === "kanban" || vm === "list") boardViewMode.value = vm;
	const g = readStored("local", LocalKeys.BOARD_GROUPING);
	if (g === "stages" || g === "statuses") boardGrouping.value = g;
}

export function setBoardViewMode(mode: BoardViewMode): void {
	boardViewMode.value = mode;
	writeStored("local", LocalKeys.BOARD_VIEW, mode);
}
export function setBoardGrouping(view: BoardView): void {
	boardGrouping.value = view;
	writeStored("local", LocalKeys.BOARD_GROUPING, view);
}
// #endregion

// #region Footer → body intents
/** Open the ticket-creation modal (footer Create Ticket). Consumed + reset by the body. */
export const createTicketOpen = signal<boolean>(false);
/** Open the Create-Stage modal (footer Create Stage — project board only). Consumed + reset by the body. */
export const createStageOpen = signal<boolean>(false);
/** Trigger the basket checkout flow (footer Checkout Tickets). Consumed + reset by the body. */
export const checkoutOpen = signal<boolean>(false);

export function requestCreateTicket(): void {
	createTicketOpen.value = true;
}
export function requestCreateStage(): void {
	createStageOpen.value = true;
}
export function requestCheckout(): void {
	checkoutOpen.value = true;
}
// #endregion

// #region Body → footer capabilities
/**
 * What the footer needs to know to render the right controls, published by the body as its state
 * resolves — including on every Dev Context Switcher change, so a persona flip moves the footer and
 * the board together instead of leaving the rig offering an action the body would refuse.
 */
export interface BoardCaps {
	/** The acting user is the client — gates Create Stage / Create Ticket / Checkout. */
	isClient: boolean;
	/** The project pipeline board (vs a stage-level Tasks board) — gates the Stages/Status toggle + Create Stage. */
	isProjectBoard: boolean;
	/** Number of draft/unpurchased tickets in the basket (drives Add to Basket ⁄ Checkout + the count). */
	basketCount: number;
	/**
	 * Whether this engagement has tickets at all. A session is booked rather than ticketed, so the
	 * create actions are absent because there is no such thing here — a different fact from "you may
	 * not", and the rig states it rather than silently dropping the controls.
	 */
	hasTickets: boolean;
}

const EMPTY_CAPS: BoardCaps = {
	isClient: false,
	isProjectBoard: true,
	basketCount: 0,
	hasTickets: true,
};

export const boardCaps = signal<BoardCaps>(EMPTY_CAPS);

export function publishBoardCaps(caps: BoardCaps): void {
	boardCaps.value = caps;
}

/** Reset every footer↔body signal (the body calls this on unmount). */
export function resetBoardState(): void {
	createTicketOpen.value = false;
	createStageOpen.value = false;
	checkoutOpen.value = false;
	boardCaps.value = EMPTY_CAPS;
}
// #endregion
