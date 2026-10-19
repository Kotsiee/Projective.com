import type { JSX } from "preact";
import { KanbanColumn, type KanbanColumnItem } from "@ui/kanban/components/KanbanColumn.tsx";
import { DndCtx } from "@ui/dnd/core/context.ts";
import {
	BOARD_LANES,
	type BoardLane,
	type DemoFrame,
	LANE_LABEL,
} from "@features/landing/core/demos/board-model.ts";
import { BOARD_DEMO_COPY, demoMoney } from "@features/landing/core/demos/board-demo.ts";
import { BOARD_POSTER_LABEL } from "@features/landing/core/demo-stage.ts";
import { BoardTicket, NO_DROP, stillDnd } from "./BoardTicket.tsx";

// #region Bar
/** Props for {@link BoardBar}. */
export interface BoardBarProps {
	title: string;
	walletMinor: number;
	currency: string;
}

/**
 * The board's bar: its name, " · Work board" in the meta weight, and the client's wallet — the
 * balance a freelancer's start takes its hold from (K3, D1).
 */
export function BoardBar({ title, walletMinor, currency }: BoardBarProps): JSX.Element {
	return (
		<div class="lp-board-demo__bar">
			<p class="lp-board-demo__name">
				{title}
				<span class="lp-board-demo__kicker">· {BOARD_DEMO_COPY.kicker}</span>
			</p>
			<p class="lp-board-demo__wallet">
				{BOARD_DEMO_COPY.wallet}
				<span class="lp-board-demo__amount">{demoMoney(walletMinor, currency)}</span>
			</p>
		</div>
	);
}
// #endregion

// #region Picture
/** Props for {@link BoardPicture}. */
export interface BoardPictureProps {
	frame: DemoFrame;
	title: string;
	walletMinor: number;
	currency: string;
	/** The lane a phone shows (its index in `BOARD_LANES`): the one the frame is about. */
	lane: number;
}

/**
 * BoardPicture — a still of the Work board (`flows/LANDING.md` §4.4): the demo stage's poster on
 * the server, and each frame of the board's reduced-motion sequence. The real `@projective/ui`
 * kanban columns over one model frame, held still and `inert` inside a `role="img"` named
 * "Example work board with five columns." Each card's next control (Pay for this stage, Approve and
 * pay) is drawn as a picture, since nothing in a still can be pressed; the live board renders the
 * real buttons. Below `--bp-md` only the frame's lane shows, as the live board's pager does.
 */
export function BoardPicture(
	{ frame, title, walletMinor, currency, lane }: BoardPictureProps,
): JSX.Element {
	const asks = new Set(frame.needs.ids);
	const items = (column: BoardLane): KanbanColumnItem[] =>
		frame.cards.filter((card) => card.lane === column).map((card) => ({
			id: card.id,
			label: card.title,
			draggable: false,
			render: () => (
				<BoardTicket
					card={card}
					currency={currency}
					beat={frame.beat?.cardId === card.id ? frame.beat.kind : null}
					pictures
					asksToPay={asks.has(card.id)}
				/>
			),
		}));
	return (
		<div class="lp-board-demo lp-board-demo--still" role="img" aria-label={BOARD_POSTER_LABEL}>
			<div class="lp-board-demo__still" inert>
				<BoardBar title={title} walletMinor={walletMinor} currency={currency} />
				<DndCtx.Provider value={stillDnd()}>
					<div class="lp-board-demo__board" data-lane={lane}>
						<div class="ui-kanban">
							<div class="ui-kanban__board">
								{BOARD_LANES.map((column) => (
									<KanbanColumn
										key={column}
										column={{ id: column, title: LANE_LABEL[column] }}
										items={items(column)}
										dropTarget={NO_DROP}
										columnDragEnabled={false}
									/>
								))}
							</div>
						</div>
					</div>
				</DndCtx.Provider>
			</div>
		</div>
	);
}
// #endregion
