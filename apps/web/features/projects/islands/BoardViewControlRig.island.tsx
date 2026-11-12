import type { JSX, RefObject } from "preact";
import { useSignal } from "@preact/signals";
import { useEffect } from "preact/hooks";
import "../styles/board-rig.css";
import { Tooltip } from "@projective/ui/feedback";
import {
	boardCaps,
	boardGrouping,
	boardViewMode,
	requestCheckout,
	requestCreateTicket,
	restoreBoardView,
	setBoardGrouping,
	setBoardViewMode,
} from "../core/board-state.ts";
import { CreateStagePopover } from "../components/CreateStagePopover.tsx";
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
 * Stages⁄Status grouping switch · the primary actions (the client's Create Ticket · Add to
 * Basket / Checkout, and Create Stage for whoever authors stages here — Decision #421), at the
 * `md` control height. It is a DUMB island — it drives the shared board
 * signals ({@link boardViewMode} / {@link boardGrouping} + the ticket/checkout intents) and reads the
 * body's published capabilities ({@link boardCaps}); the body reacts. Create stage opens its popover on
 * the rig's own button and writes through `BoardService`, as the files rig's New folder does.
 */
export default function BoardViewControlRig(): JSX.Element {
	useEffect(() => restoreBoardView(), []);
	const stageOpen = useSignal(false);

	const vm = boardViewMode.value;
	const grouping = boardGrouping.value;
	const caps = boardCaps.value;
	const addsStage = caps.canAddStage && caps.isProjectBoard && caps.hasTickets;

	return (
		<div class="brd-rig">
			<div class="brd-rig__group" role="group" aria-label="Board view">
				<Tooltip content="Kanban board" density="compact">
					<button
						type="button"
						class="brd-rig__icon"
						aria-pressed={vm === "kanban"}
						aria-label="Kanban board"
						onClick={() => setBoardViewMode("kanban")}
					>
						<KanbanIcon size={18} />
					</button>
				</Tooltip>
				<Tooltip content="List view" density="compact">
					<button
						type="button"
						class="brd-rig__icon"
						aria-pressed={vm === "list"}
						aria-label="List view"
						onClick={() => setBoardViewMode("list")}
					>
						<ListIcon size={18} />
					</button>
				</Tooltip>
			</div>

			{caps.isProjectBoard
				? (
					<div class="brd-rig__group" role="group" aria-label="Group columns by">
						<Tooltip content="Columns by stage" density="compact">
							<button
								type="button"
								class="brd-rig__icon"
								aria-pressed={grouping === "stages"}
								aria-label="Group columns by stage"
								onClick={() => setBoardGrouping("stages")}
							>
								<StagesToggleIcon size={18} />
							</button>
						</Tooltip>
						<Tooltip content="Columns by status" density="compact">
							<button
								type="button"
								class="brd-rig__icon"
								aria-pressed={grouping === "statuses"}
								aria-label="Group columns by status"
								onClick={() => setBoardGrouping("statuses")}
							>
								<StatusToggleIcon size={18} />
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

			{(caps.isClient && caps.hasTickets) || addsStage
				? (
					<div class="brd-rig__actions">
						{caps.isClient && caps.hasTickets
							? (
								<button
									type="button"
									class="brd-rig__action"
									aria-label="Create ticket"
									onClick={requestCreateTicket}
								>
									<PlusIcon size={18} />
									<span>Ticket</span>
								</button>
							)
							: null}
						{addsStage
							? (
								<CreateStagePopover
									open={stageOpen}
									projectId={caps.projectId}
									currency={caps.stageCurrency}
									placement="top-end"
									trigger={(api) => (
										<button
											ref={api.ref as RefObject<HTMLButtonElement>}
											type="button"
											class="brd-rig__action"
											aria-label="Create stage"
											aria-haspopup="dialog"
											aria-expanded={api.expanded}
											aria-controls={api.expanded ? api.panelId : undefined}
											onClick={api.toggle}
										>
											<StagesToggleIcon size={18} />
											<span>Stage</span>
										</button>
									)}
								/>
							)
							: null}
						{!caps.isClient || !caps.hasTickets
							? null
							: caps.basketCount > 0
							? (
								<button
									type="button"
									class="brd-rig__action brd-rig__action--accent"
									aria-label={`Checkout ${caps.basketCount} ${caps.basketCount === 1 ? "ticket" : "tickets"}`}
									onClick={requestCheckout}
								>
									<CheckoutIcon size={18} />
									<span>Checkout {caps.basketCount}</span>
								</button>
							)
							: (
								<span class="brd-rig__basket" aria-hidden="true">
									<BasketIcon size={18} />
								</span>
							)}
					</div>
				)
				: null}
		</div>
	);
}
