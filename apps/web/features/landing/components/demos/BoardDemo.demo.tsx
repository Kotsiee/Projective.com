/// <reference lib="dom" />
import "@ui/kanban/styles/kanban.css";
import "../../styles/lp-theatre.css";
import "../../styles/demos/board.css";
import type { JSX } from "preact";
import { useSignal } from "@preact/signals";
import { useEffect, useId, useMemo, useRef } from "preact/hooks";
import { KanbanBoard } from "@ui/kanban/islands/KanbanBoard.tsx";
import type { KanbanColumn as KanbanColumnModel, KanbanItemMove } from "@ui/kanban/core/types.ts";
import type { DemoComponent, DemoProps } from "@features/landing/core/demos/demo-contract.ts";
import {
	approve,
	BOARD_LANES,
	type BoardAction,
	type BoardLane,
	cardById,
	cardView,
	createBoard,
	type DemoBeat,
	type DemoBoardState,
	type DemoCardView,
	dropRefusalOf,
	LANE_LABEL,
	pay,
	reduceBoard,
	start,
} from "@features/landing/core/demos/board-model.ts";
import { DEMO_BOARD } from "@features/landing/core/demos/board-fixtures.ts";
import {
	BOARD_DEMO_COPY,
	boardAnnouncement,
	boardFrames,
	boardNotice,
	canPay,
	cardLabel,
	frameAnnouncement,
	laneCounter,
	moneyLead,
	moveLabel,
	refusalText,
	stepCounter,
} from "@features/landing/core/demos/board-demo.ts";
import { BoardBar, BoardPicture } from "./BoardPicture.tsx";
import { BoardTicket } from "./BoardTicket.tsx";

// #region Board facts
/** The board's lanes as the kanban takes them: the product's five, none reorderable or sortable. */
const COLUMNS: KanbanColumnModel[] = BOARD_LANES.map((lane) => ({
	id: lane,
	title: LANE_LABEL[lane],
}));

/**
 * Pointer drag is the main input only for a fine pointer from --bp-md (§2.2 note 12). Where it is,
 * each card is focusable and the kanban's own keyboard path moves it; where it is not, each card's
 * "Move to…" menu does.
 */
const DRAG_QUERY = "(min-width: 768px) and (pointer: fine)";

/** The Ready lane: where a phone's pager opens, on the task waiting for its money. */
const READY_LANE = BOARD_LANES.indexOf("todo");

/** Whether `value` is one of the board's lanes. */
function isLane(value: string): value is BoardLane {
	return (BOARD_LANES as readonly string[]).includes(value);
}

/** The lanes a card's "Move to…" menu offers: every move the board makes, and the refusal it explains. */
function moveTargets(state: DemoBoardState, card: DemoCardView): BoardLane[] {
	return BOARD_LANES.filter((lane) => {
		if (lane === card.lane) return false;
		const refusal = dropRefusalOf(state, card.id, lane);
		return refusal === null || refusal === "needs_funding";
	});
}

/** The card the last outcome changed, and how — what its face shows. */
function beatOf(state: DemoBoardState): DemoBeat | null {
	const last = state.last;
	if (last?.kind === "paid") return { cardId: last.cardId, kind: "paid" };
	if (last?.kind === "approved") return { cardId: last.cardId, kind: "team_paid" };
	return null;
}
// #endregion

// #region Glyphs
/** A padlock: a refused move (§3.2 "Demo-stage status": colour, an icon and the words). */
function LockGlyph(): JSX.Element {
	return (
		<svg class="lp-board-demo__glyph" viewBox="0 0 16 16" aria-hidden="true">
			<rect x="3" y="7" width="10" height="7" rx="1.5" />
			<path d="M5.5 7V5a2.5 2.5 0 0 1 5 0v2" />
		</svg>
	);
}

/** A check: the team paid. */
function CheckGlyph(): JSX.Element {
	return (
		<svg class="lp-board-demo__glyph" viewBox="0 0 16 16" aria-hidden="true">
			<path d="M3.5 8.5l3 3 6-7" />
		</svg>
	);
}
// #endregion

// #region Move menu
/** Props for {@link MoveMenu}. */
interface MoveMenuProps {
	cardId: string;
	title: string;
	/** The lanes the card can be moved to (and the refusal the model explains). */
	targets: readonly BoardLane[];
	onMove: (lane: BoardLane) => void;
}

/**
 * A card's "Move to…" menu, where a card cannot be dragged (below --bp-md, a coarse pointer, or a
 * zoomed window): a disclosure button that opens the card's lanes as buttons, so a move is only ever
 * made by activating one (Enter, Space or a tap) — never by arrowing through a list (WCAG 3.2.2).
 * Escape closes it and returns focus to the button; leaving it closes it.
 */
function MoveMenu({ cardId, title, targets, onMove }: MoveMenuProps): JSX.Element {
	const open = useSignal(false);
	const toggle = useRef<HTMLButtonElement>(null);
	const listId = useId();
	return (
		<div
			class="lp-board-demo__move"
			onKeyDown={(event) => {
				if (event.key !== "Escape" || !open.value) return;
				event.preventDefault();
				event.stopPropagation();
				open.value = false;
				toggle.current?.focus();
			}}
			onFocusOut={(event) => {
				const next = event.relatedTarget;
				if (next instanceof Node && event.currentTarget.contains(next)) return;
				open.value = false;
			}}
		>
			<button
				ref={toggle}
				type="button"
				class="lp-board-demo__move-toggle"
				data-card={cardId}
				aria-label={moveLabel(title)}
				aria-expanded={open.value ? "true" : "false"}
				aria-controls={listId}
				onClick={() => (open.value = !open.value)}
			>
				{BOARD_DEMO_COPY.moveTo}
			</button>
			<ul
				id={listId}
				class="lp-board-demo__move-list"
				aria-label={moveLabel(title)}
				hidden={!open.value}
			>
				{targets.map((target) => (
					<li key={target}>
						<button
							type="button"
							class="lp-board-demo__move-option"
							onClick={() => {
								open.value = false;
								onMove(target);
							}}
						>
							{LANE_LABEL[target]}
						</button>
					</li>
				))}
			</ul>
		</div>
	);
}
// #endregion

// #region Live board
/**
 * The interactive board (§4.4 Work board, §6 V1): the real `@projective/ui` kanban over the board
 * model, driven by its pointer drag and its keyboard path (Space to pick up, arrows to move, Enter to
 * drop, Escape to cancel) where a fine pointer and --bp-md allow a drag, and otherwise by each
 * card's own "Move to…" menu — the demo's touch path, never presented as a product feature. You
 * play both sides (the role note): a drag is the freelancer starting work, "Pay for this stage" and
 * "Approve and pay" are the client's. Only one of those is the board's filled control at a time
 * ({@link moneyLead}); the others are outlined until they are next. Every move goes through
 * `reduceBoard`, so a lane refuses exactly what the model refuses and the host's live region says
 * what happened; a control that disappears with its move hands focus to the card it moved.
 */
function LiveBoard({ feeBp, resetSignal, announce }: DemoProps): JSX.Element {
	const board = useSignal<DemoBoardState>(createBoard(DEMO_BOARD, { feeBp }));
	const nudges = useSignal(0);
	const lane = useSignal(READY_LANE);
	const drag = useSignal(globalThis.matchMedia?.(DRAG_QUERY).matches ?? false);
	const lastReset = useRef(resetSignal);
	const root = useRef<HTMLDivElement>(null);

	useEffect(() => {
		const query = globalThis.matchMedia(DRAG_QUERY);
		const sync = () => (drag.value = query.matches);
		sync();
		query.addEventListener("change", sync);
		return () => query.removeEventListener("change", sync);
	}, []);

	useEffect(() => {
		if (lastReset.current === resetSignal) return;
		lastReset.current = resetSignal;
		board.value = createBoard(DEMO_BOARD, { feeBp });
		lane.value = READY_LANE;
	}, [resetSignal]);

	const dispatch = (action: BoardAction) => {
		const holding = root.current?.contains(document.activeElement) ?? false;
		const next = reduceBoard(board.value, action);
		board.value = next;
		const outcome = next.last;
		if (outcome?.kind === "refused") nudges.value += 1;
		if (
			outcome?.kind === "moved" || outcome?.kind === "started" || outcome?.kind === "approved" ||
			outcome?.kind === "paid"
		) {
			const moved = cardById(next, outcome.cardId);
			if (moved) {
				lane.value = BOARD_LANES.indexOf(moved.status);
				if (holding) refocus(moved.id, cardLabel(cardView(moved), next.currency));
			}
		}
		const message = boardAnnouncement(next);
		if (message) announce(message);
	};

	/**
	 * A card that changes lane is drawn anew in its new lane, and a paid card loses its Pay button, so
	 * the control the visitor pressed is gone: keep their place on that card — the card itself where
	 * it can be focused (a keyboard drag), else its first control ("Move to…", Pay, Approve).
	 */
	const refocus = (cardId: string, label: string) => {
		requestAnimationFrame(() => {
			const host = root.current;
			if (!host || (document.activeElement && host.contains(document.activeElement))) return;
			const card = [...host.querySelectorAll<HTMLElement>(".ui-kanban__card[tabindex]")]
				.find((element) => element.getAttribute("aria-label") === label);
			(card ?? host.querySelector<HTMLElement>(`[data-card="${cardId}"]`))?.focus();
		});
	};

	const state = board.value;
	const views = state.cards.map(cardView);
	const lead = moneyLead(state);
	const beat = beatOf(state);
	const refused = state.last?.kind === "refused" ? state.last.cardId : null;
	const notice = boardNotice(state);

	return (
		<div class="lp-board-demo" ref={root}>
			<BoardBar title={state.title} walletMinor={state.walletMinor} currency={state.currency} />
			<div class="lp-board-demo__status">
				{notice
					? (
						<p
							key={`${notice.kind}:${notice.text}`}
							class="lp-board-demo__notice"
							data-kind={notice.kind}
						>
							{notice.kind === "refused" ? <LockGlyph /> : <CheckGlyph />}
							<span class="lp-board-demo__notice-text">{notice.text}</span>
							{notice.kind === "paid" && notice.detail
								? <span class="lp-board-demo__detail">{notice.detail}</span>
								: null}
						</p>
					)
					: (
						<p class="lp-board-demo__hint">
							{drag.value
								? <span class="lp-board-demo__hint-drag">{BOARD_DEMO_COPY.dragHint}</span>
								: null}
							<span class="lp-board-demo__hint-keys">{BOARD_DEMO_COPY.keyboardHelp}</span>
						</p>
					)}
			</div>
			<div class="lp-board-demo__pager">
				<button
					type="button"
					class="lp-demo-btn lp-board-demo__page"
					aria-label={BOARD_DEMO_COPY.previousLane}
					aria-disabled={lane.value === 0 ? "true" : undefined}
					onClick={() => {
						if (lane.value > 0) lane.value -= 1;
					}}
				>
					<span aria-hidden="true">←</span>
				</button>
				<span class="lp-board-demo__count">{laneCounter(lane.value)}</span>
				<button
					type="button"
					class="lp-demo-btn lp-board-demo__page"
					aria-label={BOARD_DEMO_COPY.nextLane}
					aria-disabled={lane.value === BOARD_LANES.length - 1 ? "true" : undefined}
					onClick={() => {
						if (lane.value < BOARD_LANES.length - 1) lane.value += 1;
					}}
				>
					<span aria-hidden="true">→</span>
				</button>
			</div>
			<div class="lp-board-demo__board" data-lane={lane.value}>
				<KanbanBoard<DemoCardView>
					columns={COLUMNS}
					items={views}
					getItemId={(card) => card.id}
					getItemColumn={(card) => card.lane}
					getItemLabel={(card) => cardLabel(card, state.currency)}
					ariaLabel={`${state.title} · ${BOARD_DEMO_COPY.kicker}`}
					itemDraggable={() => drag.value}
					itemDropRefusal={(card, column) => {
						const reason = isLane(column.id) ? dropRefusalOf(state, card.id, column.id) : null;
						return reason === null ? null : refusalText(reason);
					}}
					onItemMove={(move: KanbanItemMove) => {
						if (isLane(move.toColumn)) dispatch(start(move.itemId, move.toColumn));
					}}
					renderItem={(card, ctx) => (
						<BoardTicket
							card={card}
							currency={state.currency}
							beat={!ctx.overlay && beat?.cardId === card.id ? beat.kind : null}
							nudge={!ctx.overlay && refused === card.id ? nudges.value : 0}
						/>
					)}
					renderItemActions={(card) => {
						// Where a card can be dragged, the drag and its keyboard path move it; the menu
						// is only for where it cannot.
						const targets = drag.value ? [] : moveTargets(state, card);
						const payable = canPay(state, card.id);
						if (!payable && !card.awaitsApproval && targets.length === 0) return null;
						// One filled control on the board: the lead's money action; the rest outlined.
						const money = card.id === lead
							? "lp-demo-btn lp-demo-btn--money"
							: "lp-demo-btn lp-board-demo__later";
						return (
							<>
								{payable
									? (
										<button
											type="button"
											class={money}
											data-card={card.id}
											aria-label={`${BOARD_DEMO_COPY.pay}, “${card.title}”`}
											onClick={() => dispatch(pay(card.id))}
										>
											{BOARD_DEMO_COPY.pay}
										</button>
									)
									: null}
								{card.awaitsApproval
									? (
										<button
											type="button"
											class={money}
											data-card={card.id}
											aria-label={`${BOARD_DEMO_COPY.approve}, “${card.title}”`}
											onClick={() => dispatch(approve(card.id))}
										>
											{BOARD_DEMO_COPY.approve}
										</button>
									)
									: null}
								{targets.length > 0
									? (
										<MoveMenu
											cardId={card.id}
											title={card.title}
											targets={targets}
											onMove={(target) => dispatch(start(card.id, target))}
										/>
									)
									: null}
							</>
						);
					}}
				/>
			</div>
		</div>
	);
}
// #endregion

// #region Frames
/**
 * The board's reduced-motion version (§4.4 Frames, §6 V1): the same states as the live board, as
 * six labelled stills — "Step {n} of 6", the frame's caption, the board as it stands — with
 * Previous step and Next step. Nothing plays by itself; each step is announced.
 */
function BoardFrames({ feeBp, resetSignal, announce }: DemoProps): JSX.Element {
	const steps = useMemo(() => boardFrames(feeBp), [feeBp]);
	const index = useSignal(0);
	const lastReset = useRef(resetSignal);

	useEffect(() => {
		if (lastReset.current === resetSignal) return;
		lastReset.current = resetSignal;
		index.value = 0;
	}, [resetSignal]);

	const go = (next: number) => {
		if (next < 0 || next >= steps.length) return;
		index.value = next;
		announce(frameAnnouncement(steps[next], next, steps.length));
	};
	const step = steps[index.value];

	return (
		<div class="lp-demo-frames lp-board-frames">
			<div class="lp-demo-frames__head">
				<p class="lp-demo-counter">{stepCounter(index.value, steps.length)}</p>
				<p class="lp-demo-frames__caption">{step.caption}</p>
				{step.note ? <p class="lp-demo-note">{step.note}</p> : null}
			</div>
			<div class="lp-demo-frames__picture">
				<BoardPicture
					frame={step.frame}
					title={DEMO_BOARD.title}
					walletMinor={step.walletMinor}
					currency={DEMO_BOARD.currency}
					lane={step.lane}
				/>
			</div>
			<div class="lp-demo-frames__nav">
				<button
					type="button"
					class="lp-demo-step"
					aria-disabled={index.value === 0 ? "true" : undefined}
					onClick={() => go(index.value - 1)}
				>
					{BOARD_DEMO_COPY.previousStep}
				</button>
				<button
					type="button"
					class="lp-demo-step"
					aria-disabled={index.value === steps.length - 1 ? "true" : undefined}
					onClick={() => go(index.value + 1)}
				>
					{BOARD_DEMO_COPY.nextStep}
				</button>
			</div>
		</div>
	);
}
// #endregion

// #region Demo
/**
 * BoardDemo — the demo stage's Work board tab (`?demo=board`; `flows/LANDING.md` §4.4, §6 V1):
 * the live board while motion is allowed, its six labelled frames under either reduced-motion
 * channel. A pure simulation over `DEMO_BOARD`: it never fetches and never writes.
 */
const BoardDemo: DemoComponent = (props) =>
	props.reducedMotion ? <BoardFrames {...props} /> : <LiveBoard {...props} />;

export default BoardDemo;
// #endregion
