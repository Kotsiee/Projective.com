import type { ComponentChildren, JSX } from "preact";
import { type Signal, signal } from "@preact/signals";
import { formatTicketMoney } from "@projective/types/projects";
import { MoneyView } from "@projective/ui/display/money";
import { Tag } from "@ui/display/components/Tag.tsx";
import { KanbanColumn, type KanbanColumnItem } from "@ui/kanban/components/KanbanColumn.tsx";
import type {
	KanbanColumn as KanbanColumnModel,
	KanbanColumnRenderCtx,
} from "@ui/kanban/core/types.ts";
import { type DndContextValue, DndCtx } from "@ui/dnd/core/context.ts";
import { createDndStore } from "@ui/dnd/core/store.ts";
import MoneyFlowIsland from "@features/landing/islands/MoneyFlow.island.tsx";
import {
	type BoardLane,
	CLEARS_IN_DAYS,
	FUNDING_TAG_LABEL,
	FUNDING_TAG_TONE,
	type FundingNeeded,
	type FundingTag,
	LANE_LABEL,
} from "@features/landing/core/demos/board-model.ts";
import {
	FLOW_BOARD,
	FLOW_NODE_LABEL,
	FLOW_NODES,
	FLOW_WORDS,
	type FlowFrame,
	type FlowMove,
	type FlowNode,
	type FlowNodeState,
	flowSteps,
	HOW_IT_WORKS,
	moneyFlowFrames,
	stepSpans,
	stepsWhere,
} from "@features/landing/core/money-flow.ts";

// #region Contract
/** Props for {@link MoneyFlowStage}. */
export interface MoneyFlowStageProps {
	/**
	 * The platform fee in basis points from the server (`PublicMetricsService` `platformFeeBp`);
	 * `null` when it is unavailable, and then every fee clause drops (`flows/LANDING.md` §4 "If the
	 * fee is unavailable"): step 5 reads "The team is paid." and the team's amounts are not shown.
	 */
	feeBp: number | null;
}

/** The stage's board crop: the three lanes the task crosses (the product's lane titles, K1). */
const FLOW_LANES: readonly BoardLane[] = ["todo", "in_progress", "in_review"];

/** A no-break space: holds an empty line's height, so a step that shows nothing there never shifts. */
const BLANK = " ";

/** Every figure is GBP, en-GB, pinned (§4 "Money is GBP, en-GB, pinned"). */
const MONEY = { currency: "GBP", displayCurrency: "GBP", locale: "en-GB", table: null } as const;
// #endregion

// #region Step marks
/** `data-mf-on`: the steps an element shows on (the stylesheet toggles it by the window's `data-step`). */
function on(steps: readonly number[]): string {
	return steps.join(" ");
}

/** Props for {@link Slot}. */
interface SlotProps<T> {
	frames: readonly FlowFrame[];
	pick: (frame: FlowFrame) => T;
	render: (value: T) => ComponentChildren;
	class?: string;
}

/**
 * One changing thing in the window: each distinct value rendered once, marked with the steps it
 * shows on and stacked in one grid cell, so a step change only swaps which copy is visible. A still
 * (one frame) renders its one value plainly.
 */
function Slot<T>({ frames, pick, render, class: className }: SlotProps<T>): JSX.Element {
	const spans = stepSpans(frames.map(pick));
	const cls = className ? `lp-mf__slot ${className}` : "lp-mf__slot";
	if (spans.length === 1) return <span class={cls}>{render(spans[0].value)}</span>;
	return (
		<span class={cls}>
			{spans.map((span) => (
				<span
					key={span.steps.join("-")}
					class="lp-mf__variant"
					data-mf-on={on(span.steps.map((index) => frames[index - 1].step))}
				>
					{render(span.value)}
				</span>
			))}
		</span>
	);
}
// #endregion

// #region Board
/**
 * The drag context the package's kanban parts need in order to render. Nothing in the stage is
 * dragged and the board is never hydrated, so its sensors are inert (as the hero theatre's).
 */
function stillDnd(): DndContextValue {
	return {
		store: createDndStore(),
		armPointer: () => {},
		beginKeyboard: () => {},
		keyboardActive: () => false,
	};
}

/** No drop target: nothing is ever dragged over the stage. */
const NO_DROP: Signal<{ columnId: string; renderIndex: number } | null> = signal(null);

/** The board header's money line (K8): "1 task needs £2,000 to start", or `null`. */
function needsLine(needs: FundingNeeded): string | null {
	if (needs.count === 0) return null;
	const total = formatTicketMoney(needs.totalMinor, FLOW_BOARD.currency);
	return needs.count === 1
		? `1 task needs ${total} to start`
		: `${needs.count} tasks need ${total} to start`;
}

/** Props for {@link FlowTicket}. */
interface FlowTicketProps {
	/** The frames in which the task stands in this lane. */
	frames: readonly FlowFrame[];
	lane: BoardLane;
}

/**
 * The task's card in one lane, on the product card's anatomy (`TicketCard`, as the hero theatre
 * draws it): the title, then the stage on the left and the funding tag, price and the assigned
 * team's avatar on the right; in Review, pictures of the client's two review controls.
 */
function FlowTicket({ frames, lane }: FlowTicketProps): JSX.Element {
	const total = frames[0].card.totalMinor;
	return (
		<div
			class="lp-ticket lp-mf__ticket"
			data-mf-card=""
			data-mf-on={on(frames.map((f) => f.step))}
		>
			<p class="lp-ticket__title">{frames[0].card.title}</p>
			<div class="lp-ticket__foot">
				<Slot
					frames={frames}
					pick={(frame) => frame.card.stageName ?? ""}
					render={(name) => <span class="lp-ticket__stage">{name}</span>}
				/>
				<span class="lp-ticket__end">
					{frames.some((frame) => frame.card.tag !== null)
						? (
							<Slot
								class="lp-mf__tag-slot"
								frames={frames}
								pick={(frame): FundingTag | null => frame.card.tag}
								render={(tag) =>
									tag
										? (
											<span class="lp-ticket__tag" data-tone={FUNDING_TAG_TONE[tag]}>
												{FUNDING_TAG_LABEL[tag]}
											</span>
										)
										: null}
							/>
						)
						: null}
					{total !== null
						? (
							<span class="lp-ticket__budget">
								{formatTicketMoney(total, FLOW_BOARD.currency)}
							</span>
						)
						: null}
					{frames[0].card.assignee?.avatar
						? (
							<img
								class="lp-ticket__avatar"
								src={frames[0].card.assignee.avatar}
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
			{lane === "in_review"
				? (
					<span class="lp-mf__review">
						<span class="lp-mf__pic lp-mf__pic--outline">{FLOW_WORDS.askForChanges}</span>
						<span class="lp-mf__pic">{FLOW_WORDS.approveAndPay}</span>
					</span>
				)
				: null}
		</div>
	);
}

/** Props for {@link FlowBoard}. */
interface FlowBoardProps {
	frames: readonly FlowFrame[];
}

/**
 * The stage's board: the real `@projective/ui` kanban columns for the lanes the task crosses, each
 * with the task's card for the steps it stands there and the lane's count for every step.
 */
function FlowBoard({ frames }: FlowBoardProps): JSX.Element {
	const columns: KanbanColumnModel[] = FLOW_LANES.map((lane) => ({
		id: lane,
		title: LANE_LABEL[lane],
	}));
	const header = ({ column }: KanbanColumnRenderCtx<unknown>) => (
		<>
			<span class="ui-kanban__col-title">{column.title}</span>
			<Slot
				frames={frames}
				pick={(frame) => (frame.lane === column.id ? 1 : 0)}
				render={(count) => <span class="ui-kanban__col-count">{count}</span>}
			/>
		</>
	);
	const items = (lane: BoardLane): KanbanColumnItem[] => {
		const here = frames.filter((frame) => frame.lane === lane);
		if (here.length === 0) return [];
		return [{
			id: `${here[0].card.id}-${lane}`,
			label: here[0].card.title,
			draggable: false,
			render: () => <FlowTicket frames={here} lane={lane} />,
		}];
	};
	return (
		<DndCtx.Provider value={stillDnd()}>
			<div class="ui-kanban lp-mf__board">
				<div class="ui-kanban__board lp-mf__lanes">
					{columns.map((column) => (
						<KanbanColumn
							key={column.id}
							column={column}
							items={items(column.id as BoardLane)}
							dropTarget={NO_DROP}
							columnDragEnabled={false}
							header={header}
						/>
					))}
				</div>
			</div>
		</DndCtx.Provider>
	);
}
// #endregion

// #region Ledger
/** A move's amount as its coin reads it: the board card's short figure, or none when unknown. */
function coinLabel(move: FlowMove): string {
	return move.amountMinor === null ? "" : formatTicketMoney(move.amountMinor, FLOW_BOARD.currency);
}

/** Props for {@link FlowLedger}. */
interface FlowLedgerProps {
	frames: readonly FlowFrame[];
	/** The sticky stage: money travels the rail as the visitor scrolls (coins), where supported. */
	live: boolean;
}

/**
 * One place's figure, following where money rests: MoneyView's while the place holds money; a dash
 * before money reaches it; a drawn check once money has passed through it, or rests there with its
 * amount unknown (no fee), so a paid place never reads as empty and one sum is never drawn twice.
 */
function figure(
	state: Pick<FlowNodeState, "amountMinor" | "reached" | "holds">,
): ComponentChildren {
	if (state.amountMinor !== null && state.holds) {
		return <MoneyView minor={state.amountMinor} {...MONEY} size="key" />;
	}
	return state.reached
		? <span class="lp-mf__none lp-mf__none--paid" />
		: <span class="lp-mf__none">—</span>;
}

/** A place's status: the team's and the bank's are money lifecycle statuses (the app's Tag). */
function status(node: FlowNode, text: string | null): ComponentChildren {
	if (text === null) return <span class="lp-mf__status">{BLANK}</span>;
	if (node === "team" || node === "bank") {
		const severity = text === FLOW_WORDS.available ? "success" : "info";
		return <Tag class="lp-mf__tag" value={text} severity={severity} variant="subtle" />;
	}
	return <span class="lp-mf__status">{text}</span>;
}

/** Props for {@link Line}. */
interface LineProps<T> extends SlotProps<T | null> {
	/** A still drops a line its step leaves empty; the sticky stage keeps its height for every step. */
	still: boolean;
}

/** A line of a place that some steps leave empty. */
function Line<T>({ still, ...slot }: LineProps<T>): JSX.Element | null {
	if (still && slot.pick(slot.frames[0]) === null) return null;
	return <Slot {...slot} />;
}

/**
 * The money: four places on one rail — your wallet, held safely, team paid, their bank — each with
 * its MoneyView figure and state, the place money has just reached named at full strength. A
 * segment of the rail fills once money has crossed it; on the sticky stage a coin carries each move
 * along its segment as its step scrolls into place, and the team's seven clearing days fill one by
 * one.
 */
function FlowLedger({ frames, live }: FlowLedgerProps): JSX.Element {
	const still = frames.length === 1;
	return (
		<div class="lp-mf__ledger">
			{FLOW_NODES.map((node, index) => {
				const next = FLOW_NODES[index + 1];
				const coins = live && next
					? frames.flatMap((frame) =>
						frame.moves.flatMap((move, at) =>
							move.from === node ? [{ id: `${frame.step}-${at}`, move }] : []
						)
					)
					: [];
				const fresh = stepsWhere(frames, (frame) => frame.moves.some((move) => move.to === node));
				const clearing = stepsWhere(frames, (frame) => frame.clearing);
				return (
					<div key={node} class="lp-mf__node" data-node={node}>
						<span
							class="lp-mf__dot"
							data-mf-on={on(stepsWhere(frames, (frame) => frame.nodes[node].holds))}
						/>
						{next
							? (
								<span class="lp-mf__seg">
									<span
										class="lp-mf__fill"
										data-mf-on={on(stepsWhere(frames, (frame) => frame.nodes[next].reached))}
									/>
									{coins.map(({ id, move }) => (
										<span key={id} class="lp-mf__track" data-mf-coin={id}>
											<span class="lp-mf__coin">{coinLabel(move)}</span>
										</span>
									))}
								</span>
							)
							: null}
						<span class="lp-mf__label" data-mf-on={on(fresh)}>{FLOW_NODE_LABEL[node]}</span>
						<Slot
							class="lp-mf__figure"
							frames={frames}
							pick={(frame) => ({
								amountMinor: frame.nodes[node].amountMinor,
								reached: frame.nodes[node].reached,
								holds: frame.nodes[node].holds,
							})}
							render={figure}
						/>
						<Line
							still={still}
							frames={frames}
							pick={(frame) => frame.nodes[node].status}
							render={(text) => status(node, text)}
						/>
						{node === "team"
							? (
								<>
									<Line
										still={still}
										frames={frames}
										pick={(frame) => frame.nodes.team.note}
										render={(note) => <span class="lp-mf__note">{note ?? BLANK}</span>}
									/>
									{!still || clearing.length > 0
										? (
											<span class="lp-mf__days" data-mf-on={on(clearing)}>
												{Array.from({ length: CLEARS_IN_DAYS }, (_, day) => (
													<span
														key={day}
														class="lp-mf__day"
														data-mf-on={on(stepsWhere(frames, (frame) => frame.clearedDays > day))}
													/>
												))}
											</span>
										)
										: null}
								</>
							)
							: null}
					</div>
				);
			})}
		</div>
	);
}
// #endregion

// #region Window
/** Props for {@link FlowWindow}. */
interface FlowWindowProps {
	/** Every frame (the sticky stage) or one (a step's still). */
	frames: readonly FlowFrame[];
	live?: boolean;
}

/**
 * The stage's window: a picture of the product — the board's bar, the board crop and the money
 * rail — over the flow's frames. The sticky stage holds every frame and shows the one its
 * `data-step` names (the island moves it with the reading line); a still holds one, and keeps to
 * the half of the picture its step is about on a phone (`data-focus`).
 */
function FlowWindow({ frames, live = false }: FlowWindowProps): JSX.Element {
	const first = frames[0];
	// The money line takes room only where a frame says it: a still whose step needs nothing drops
	// it, and the sticky stage keeps one line for every step only if some step needs one.
	const needs = frames.some((frame) => needsLine(frame.needs) !== null);
	return (
		<div
			class={`lp-mf__window${live ? " lp-mf__window--live" : ""}`}
			data-step={first.step}
			data-focus={live ? undefined : first.focus}
		>
			<div class="lp-mf__frame">
				<div class="lp-mf__bar">
					<p class="lp-mf__name">
						{FLOW_BOARD.title}
						<span class="lp-mf__kicker">· {FLOW_WORDS.board}</span>
					</p>
					{needs
						? (
							<Slot
								class="lp-mf__needs"
								frames={frames}
								pick={(frame) => needsLine(frame.needs)}
								render={(line) => <span class="lp-mf__needs-text">{line ?? BLANK}</span>}
							/>
						)
						: null}
				</div>
				<FlowBoard frames={frames} />
				<FlowLedger frames={frames} live={live} />
			</div>
		</div>
	);
}
// #endregion

// #region Component
/**
 * MoneyFlowStage — "How it works" (`id="how-it-works"`, the anchor the header and the footer link
 * as `/#how-it-works`; `flows/LANDING.md` §4.3, §2.7; Decision #288 (F)): the six steps, verbatim,
 * beside ONE money flow that advances as the visitor scrolls — a funded stage held safely, the team
 * at work, review, approval paying the team after the fee, the same task's next stage funded from
 * the wallet, seven days of clearing and the withdrawal to their bank.
 *
 * The text carries the meaning; every picture of the flow is `aria-hidden`. Server-rendered whole:
 *
 *   - Each step renders its own still (the flow at that step) beside its text from `--bp-md`, under
 *     it below — the page with no JavaScript, and on a phone, reads top to bottom.
 *   - From `--bp-md` with scripting, one sticky window replaces the stills: the steps scroll natively
 *     past it and the MoneyFlow island ({@link MoneyFlowIsland}) moves its `data-step` as each
 *     step's top reaches the reading line, so it never hijacks the scroll. Where the browser has
 *     scroll-driven animations, the rail's fills, coins and clearing days follow the scroll itself.
 *     Under either reduced-motion channel the window changes instantly and nothing is scroll-linked.
 *
 * The window is the section's one elevated object: the real `@projective/ui` kanban columns and
 * MoneyView figures over the board-model fixture (`core/money-flow.ts`), its status words the
 * product's Tag; the steps themselves are plain text on a numbered hairline spine.
 */
export default function MoneyFlowStage({ feeBp }: MoneyFlowStageProps): JSX.Element {
	const steps = flowSteps(feeBp);
	const frames = moneyFlowFrames(feeBp);
	return (
		<section class="lp-mf" id="how-it-works" aria-labelledby="how-it-works-title">
			<div class="lp-mf__inner">
				<header class="lp-mf__head">
					<h2 class="lp-eyebrow lp-mf__title" id="how-it-works-title">{HOW_IT_WORKS.heading}</h2>
					<p class="lp-display lp-display--section lp-mf__lead">{HOW_IT_WORKS.subline}</p>
				</header>
				<div class="lp-mf__body">
					<ol class="lp-mf__steps">
						{steps.map((step, index) => (
							<li
								key={step.title}
								class="lp-mf__step"
								data-active={index === 0 ? "" : undefined}
							>
								<span class="lp-mf__num" aria-hidden="true">
									{String(index + 1).padStart(2, "0")}
								</span>
								<span class="lp-mf__node-mark" aria-hidden="true" />
								<div class="lp-mf__copy">
									<h3 class="lp-heading lp-mf__step-title">{step.title}</h3>
									<p class="lp-body lp-mf__step-body">{step.body.join(" ")}</p>
								</div>
								<div class="lp-mf__still" aria-hidden="true">
									<FlowWindow frames={[frames[index]]} />
								</div>
							</li>
						))}
					</ol>
					<div class="lp-mf__stage" aria-hidden="true">
						<FlowWindow frames={frames} live />
					</div>
					<p class="lp-mf__more">
						<a class="lp-mf__link" href={HOW_IT_WORKS.href}>{HOW_IT_WORKS.link}</a>
					</p>
					<MoneyFlowIsland />
				</div>
			</div>
		</section>
	);
}
// #endregion
