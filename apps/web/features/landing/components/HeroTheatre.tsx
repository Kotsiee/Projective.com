import type { JSX } from "preact";
import { type Signal, signal } from "@preact/signals";
import { formatTicketMoney } from "@projective/types/projects";
import { KanbanColumn, type KanbanColumnItem } from "@ui/kanban/components/KanbanColumn.tsx";
import type {
	KanbanColumn as KanbanColumnModel,
	KanbanColumnRenderCtx,
} from "@ui/kanban/core/types.ts";
import { type DndContextValue, DndCtx } from "@ui/dnd/core/context.ts";
import { createDndStore } from "@ui/dnd/core/store.ts";
import HeroTheatreIsland from "@features/landing/islands/HeroTheatre.island.tsx";
import { boardTurnMs } from "@features/landing/core/hero-motion.ts";
import type { TheatreFrame } from "@features/landing/core/theatre-player.ts";
import {
	BOARD_LANES,
	type BoardLane,
	createBoard,
	type DemoCardView,
	type DemoFrame,
	FUNDING_TAG_LABEL,
	FUNDING_TAG_TONE,
	type FundingNeeded,
	LANE_LABEL,
	scriptFrames,
} from "@features/landing/core/demos/board-model.ts";
import { HERO_BOARD, HERO_LOOP } from "@features/landing/core/demos/board-fixtures.ts";

// #region Copy
/** The theatre's words (`flows/LANDING.md` §4.1, §4.4; §5 rows B3, K1, K8). */
const THEATRE = {
	/** The figure's accessible name: the picture's one claim (B3). */
	label: "Example board: work starts once a task is paid for.",
	kicker: "Work board",
	fund: "Fund all",
	approve: "Approve and pay",
	tryLabel: "Try it yourself",
	/** The demo stage's Work board, at every width, once the page renders it ({@link HeroTheatreProps.demo}). */
	tryHref: "/?demo=board#demo",
} as const;

/** The board header's money line (K8): "1 task needs £400 to start", or `null` when none waits. */
function needsLine(needs: FundingNeeded, currency: string): string | null {
	if (needs.count === 0) return null;
	const total = formatTicketMoney(needs.totalMinor, currency);
	return needs.count === 1
		? `1 task needs ${total} to start`
		: `${needs.count} tasks need ${total} to start`;
}
// #endregion

// #region Frames
/** A model frame as the island's player writes it: every string already formatted. */
function theatreFrame(frame: DemoFrame, currency: string): TheatreFrame {
	return {
		cards: frame.cards.map((card) => ({
			id: card.id,
			lane: card.lane,
			stage: card.stageName,
			tag: card.tag ? FUNDING_TAG_LABEL[card.tag] : null,
			tone: card.tag ? FUNDING_TAG_TONE[card.tag] : null,
			approve: card.awaitsApproval,
		})),
		needs: needsLine(frame.needs, currency),
		beat: frame.beat,
	};
}
// #endregion

// #region Static kanban
/**
 * The drag context the package's kanban parts need in order to render. Nothing in the theatre is
 * dragged — its cards are neither draggable nor activatable, so they render with no role and no tab
 * stop — and the board is never hydrated, so its sensors are inert.
 */
function stillDnd(): DndContextValue {
	return {
		store: createDndStore(),
		armPointer: () => {},
		beginKeyboard: () => {},
		keyboardActive: () => false,
	};
}

/** No drop target: nothing is ever dragged over the theatre. */
const NO_DROP: Signal<{ columnId: string; renderIndex: number } | null> = signal(null);

/** A lane's header: the product's title and count, marked for the player. */
function laneHeader({ column, count }: KanbanColumnRenderCtx<unknown>): JSX.Element {
	return (
		<>
			<span class="ui-kanban__col-title" data-lp-lane={column.id}>{column.title}</span>
			<span class="ui-kanban__col-count" data-lp-count="" aria-hidden="true">{count}</span>
		</>
	);
}

/** Props for {@link TicketFace}. */
interface TicketFaceProps {
	card: DemoCardView;
	currency: string;
}

/**
 * One card's content, on the product card's anatomy (`TicketCard`): the title, then the stage on
 * the left and the funding tag, price and assignee on the right. The tag and the approve control
 * are always rendered, hidden when the frame has none, so the loop can show them without a re-render.
 */
function TicketFace({ card, currency }: TicketFaceProps): JSX.Element {
	return (
		<div class="lp-ticket" data-lp-card={card.id}>
			<p class="lp-ticket__title">{card.title}</p>
			<div class="lp-ticket__foot">
				<span class="lp-ticket__stage" data-lp-stage="">{card.stageName ?? ""}</span>
				<span class="lp-ticket__end">
					<span
						class="lp-ticket__tag"
						data-lp-tag=""
						data-tone={card.tag ? FUNDING_TAG_TONE[card.tag] : undefined}
						hidden={card.tag === null}
					>
						{card.tag ? FUNDING_TAG_LABEL[card.tag] : ""}
					</span>
					{card.totalMinor !== null
						? <span class="lp-ticket__budget">{formatTicketMoney(card.totalMinor, currency)}</span>
						: null}
					{card.assignee?.avatar
						? (
							<img
								class="lp-ticket__avatar"
								src={card.assignee.avatar}
								alt=""
								width={20}
								height={20}
								loading="lazy"
								decoding="async"
							/>
						)
						: <span class="lp-ticket__unassigned" />}
				</span>
			</div>
			<span class="lp-ticket__approve" data-lp-approve="" hidden={!card.awaitsApproval}>
				{THEATRE.approve}
			</span>
		</div>
	);
}

/** The lane's cards as the kanban column takes them: still, with no handle and no activation. */
function laneItems(cards: readonly DemoCardView[], lane: BoardLane, currency: string) {
	return cards.filter((card) => card.lane === lane).map((card): KanbanColumnItem => ({
		id: card.id,
		label: card.title,
		draggable: false,
		render: () => <TicketFace card={card} currency={currency} />,
	}));
}
// #endregion

// #region Component
/** Props for {@link HeroTheatre}. */
export interface HeroTheatreProps {
	/**
	 * The platform fee in basis points from the server (`platform_fee_bp`), handed to the board model
	 * so every simulated payout is the real one; omitted when it is unavailable, and then the model
	 * leaves the fee unknown. The theatre itself shows no fee.
	 */
	feeBp?: number;
	/**
	 * The page renders the demo stage (`#demo`, honouring `?demo=board`; work order L3). Until it
	 * does, "Try it yourself" is not rendered and the poster is a plain figure: a link to a section the
	 * page does not have would reload the page and do nothing else (root CLAUDE.md §3 gate 11), the
	 * rule the header pill follows for its own section links.
	 */
	demo?: boolean;
}

/**
 * HeroTheatre — the hero's product theatre, layout D (`flows/LANDING.md` §2.1 note 7, §2.2 note 5,
 * §2.3 note 5, §2.4, §2.7, §4.1; Decision #284 (1)).
 *
 * A `<figure role="img">` named for its one claim, whose board subtree is `inert` (no
 * `aria-hidden`, no figcaption): the real `@projective/ui` kanban columns rendering the "Website
 * refresh" fixture through the work-board model (`core/demos/board-model.ts`) at its middle frame —
 * the still a visitor sees without JavaScript, below `--bp-md` and under either reduced-motion
 * channel. Below `--bp-md` it is a flat poster — once the demo stage exists, the whole block is the
 * "Try it yourself" link; from `--bp-md` it tilts, and on the hero timeline's board turns the
 * island's lazily loaded player steps it through the scripted loop: "Case study" is approved, the
 * team is paid, and the same task moves to its next stage, paid for from the wallet.
 *
 * Under it: the island ("Pause the example", from `--bp-md`, outside the inert figure) and, with
 * {@link HeroTheatreProps.demo}, "Try it yourself" → `/?demo=board#demo`.
 */
export default function HeroTheatre({ feeBp, demo = false }: HeroTheatreProps): JSX.Element {
	const board = createBoard(HERO_BOARD, { feeBp: feeBp ?? null });
	const frames = scriptFrames(board, HERO_LOOP);
	const still = frames[0];
	const loop = frames.map((frame) => theatreFrame(frame, board.currency));
	const needs = needsLine(still.needs, board.currency);
	const lanes: KanbanColumnModel[] = BOARD_LANES.map((lane) => ({
		id: lane,
		title: LANE_LABEL[lane],
	}));

	return (
		<div class="lp-showcase">
			<figure class="lp-theatre" role="img" aria-label={THEATRE.label}>
				<div class="lp-theatre__stage" inert>
					<div class="lp-theatre__frame">
						<div class="lp-theatre__bar">
							<p class="lp-theatre__name">
								<span class="lp-theatre__kicker">{THEATRE.kicker}</span> · {board.title}
							</p>
							<p class="lp-theatre__needs" data-lp-needs="" hidden={needs === null}>
								<span data-lp-needs-text="">{needs ?? ""}</span>
								<span class="lp-theatre__fund">{THEATRE.fund}</span>
							</p>
						</div>
						<DndCtx.Provider value={stillDnd()}>
							<div class="ui-kanban lp-theatre__board">
								<div class="ui-kanban__board lp-theatre__lanes">
									{lanes.map((column) => (
										<KanbanColumn
											key={column.id}
											column={column}
											items={laneItems(still.cards, column.id as BoardLane, board.currency)}
											dropTarget={NO_DROP}
											columnDragEnabled={false}
											header={laneHeader}
										/>
									))}
								</div>
							</div>
						</DndCtx.Provider>
					</div>
				</div>
			</figure>
			<div class={`lp-showcase__controls${demo ? "" : " lp-showcase__controls--still"}`}>
				<HeroTheatreIsland frames={loop} boardMs={boardTurnMs(loop.length - 1)} />
				{demo && (
					<a class="lp-showcase__try" href={THEATRE.tryHref}>
						{THEATRE.tryLabel}
						<span aria-hidden="true">→</span>
					</a>
				)}
			</div>
		</div>
	);
}
// #endregion
