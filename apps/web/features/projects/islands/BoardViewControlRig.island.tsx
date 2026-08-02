import type { JSX } from "preact";
import { useEffect } from "preact/hooks";
import "../styles/board-rig.css";
import { Tooltip } from "@projective/ui/feedback";
import {
	boardCaps,
	boardGrouping,
	boardViewMode,
	requestCheckout,
	requestCreateStage,
	requestCreateTicket,
	restoreBoardView,
	setBoardGrouping,
	setBoardViewMode,
} from "../core/board-state.ts";
import { ListIcon } from "../components/file-glyphs.tsx";
import {
	BasketIcon,
	CheckoutIcon,
	KanbanIcon,
	PlusIcon,
	StagesToggleIcon,
	StatusToggleIcon,
} from "../components/board-glyphs.tsx";

/**
 * BoardViewControlRig — the Kanban board's action rig, mounted in the middle-nav FOOTER band via
 * {@link boardFooterFor}. Icon-first (§B.6): the Kanban⁄List view switch · (project board) the
 * Stages⁄Status grouping switch · the primary client actions (Create Ticket · Create Stage · Add to
 * Basket / Checkout). It is a DUMB island — it drives the shared board signals ({@link boardViewMode} /
 * {@link boardGrouping} + the create/checkout intents) and reads the body's published capabilities
 * ({@link boardCaps}); the body reacts. No data access.
 */
export default function BoardViewControlRig(): JSX.Element {
	useEffect(() => restoreBoardView(), []);

	const vm = boardViewMode.value;
	const grouping = boardGrouping.value;
	const caps = boardCaps.value;

	return (
		<div class="brd-rig">
			<div class="brd-rig__group" role="group" aria-label="Board view">
				<Tooltip content="Kanban board">
					<button
						type="button"
						class="brd-rig__icon"
						aria-pressed={vm === "kanban"}
						aria-label="Kanban board"
						onClick={() => setBoardViewMode("kanban")}
					>
						<KanbanIcon size={17} />
					</button>
				</Tooltip>
				<Tooltip content="List view">
					<button
						type="button"
						class="brd-rig__icon"
						aria-pressed={vm === "list"}
						aria-label="List view"
						onClick={() => setBoardViewMode("list")}
					>
						<ListIcon size={17} />
					</button>
				</Tooltip>
			</div>

			{caps.isProjectBoard
				? (
					<div class="brd-rig__group" role="group" aria-label="Group columns by">
						<Tooltip content="Columns by stage">
							<button
								type="button"
								class="brd-rig__icon"
								aria-pressed={grouping === "stages"}
								aria-label="Group columns by stage"
								onClick={() => setBoardGrouping("stages")}
							>
								<StagesToggleIcon size={17} />
							</button>
						</Tooltip>
						<Tooltip content="Columns by status">
							<button
								type="button"
								class="brd-rig__icon"
								aria-pressed={grouping === "statuses"}
								aria-label="Group columns by status"
								onClick={() => setBoardGrouping("statuses")}
							>
								<StatusToggleIcon size={17} />
							</button>
						</Tooltip>
					</div>
				)
				: null}

			<span class="brd-rig__spacer" />

			{
				/*
				 * Two different reasons the actions can be missing, told apart deliberately. A viewer
				 * without a client seat sees ABSENCE — a control that exists only to refuse them teaches
				 * nothing. An engagement with no tickets at all (a session is booked, not ticketed) gets a
				 * sentence, because there the answer is "no such thing here", which absence would leave
				 * them hunting for.
				 */
			}
			{caps.isClient && !caps.hasTickets
				? <p class="brd-rig__note">Sessions are booked, not ticketed.</p>
				: null}

			{caps.isClient && caps.hasTickets
				? (
					<div class="brd-rig__actions">
						<button type="button" class="brd-rig__action" onClick={requestCreateTicket}>
							<PlusIcon size={16} />
							<span>Ticket</span>
						</button>
						{caps.isProjectBoard
							? (
								<button type="button" class="brd-rig__action" onClick={requestCreateStage}>
									<StagesToggleIcon size={16} />
									<span>Stage</span>
								</button>
							)
							: null}
						{caps.basketCount > 0
							? (
								<button
									type="button"
									class="brd-rig__action brd-rig__action--primary"
									onClick={requestCheckout}
								>
									<CheckoutIcon size={16} />
									<span>Checkout {caps.basketCount}</span>
								</button>
							)
							: (
								<span class="brd-rig__basket" aria-hidden="true">
									<BasketIcon size={16} />
								</span>
							)}
					</div>
				)
				: null}
		</div>
	);
}
